#include "semantic_keepout_layer/semantic_keepout_layer.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <sstream>

#include "pluginlib/class_list_macros.hpp"
#include "nav2_costmap_2d/costmap_math.hpp"

PLUGINLIB_EXPORT_CLASS(
  semantic_keepout_layer::SemanticKeepoutLayer,
  nav2_costmap_2d::Layer)

namespace semantic_keepout_layer
{

SemanticKeepoutLayer::SemanticKeepoutLayer()
: has_pending_clear_(false),
  clear_min_x_(0.0), clear_min_y_(0.0), clear_max_x_(0.0), clear_max_y_(0.0),
  robot_x_(0.0), robot_y_(0.0), zone_counter_(0), zones_changed_(false)
{
}

void SemanticKeepoutLayer::onInitialize()
{
  RCLCPP_INFO(logger_, "SemanticKeepoutLayer: Initializing...");

  current_ = true;
  enabled_ = true;

  // Get the node from the layered costmap
  auto node = node_.lock();
  if (!node) {
    RCLCPP_ERROR(logger_, "Failed to lock node");
    return;
  }

  // Create service servers
  add_zone_srv_ = node->create_service<semantic_nav_interfaces::srv::AddKeepoutZone>(
    "/add_keepout_zone",
    std::bind(
      &SemanticKeepoutLayer::addZoneCallback, this,
      std::placeholders::_1, std::placeholders::_2));

  remove_zone_srv_ = node->create_service<semantic_nav_interfaces::srv::RemoveKeepoutZone>(
    "/remove_keepout_zone",
    std::bind(
      &SemanticKeepoutLayer::removeZoneCallback, this,
      std::placeholders::_1, std::placeholders::_2));

  remove_group_srv_ = node->create_service<semantic_nav_interfaces::srv::RemoveZoneGroup>(
    "/remove_zone_group",
    std::bind(
      &SemanticKeepoutLayer::removeGroupCallback, this,
      std::placeholders::_1, std::placeholders::_2));

  // Publisher for frontend visualization
  zone_pub_ = node->create_publisher<semantic_nav_interfaces::msg::KeepoutZone>(
    "/keepout_zones", rclcpp::QoS(10).transient_local());
  zone_list_pub_ = node->create_publisher<semantic_nav_interfaces::msg::KeepoutZoneArray>(
    "/keepout_zone_list", rclcpp::QoS(1).transient_local().reliable());

  // Announce the (empty) initial state so subscribers can tell the layer is up
  {
    std::lock_guard<std::mutex> lock(zones_mutex_);
    publishZones();
  }

  RCLCPP_INFO(logger_, "SemanticKeepoutLayer: Ready. Services advertised.");
}

void SemanticKeepoutLayer::updateBounds(
  double robot_x, double robot_y, double /*robot_yaw*/,
  double * min_x, double * min_y,
  double * max_x, double * max_y)
{
  if (!enabled_) { return; }

  std::lock_guard<std::mutex> lock(zones_mutex_);

  robot_x_ = robot_x;
  robot_y_ = robot_y;

  // Expire any one-shot zones that have timed out
  expireZones();

  // Update robot-inside-zone status
  for (auto & [id, zone] : zones_) {
    bool currently_inside = isPointInPolygon(robot_x, robot_y, zone.polygon);

    if (zone.robot_inside && !currently_inside) {
      // Robot has exited the zone — promote to fully lethal
      zone.robot_inside = false;
      zones_changed_ = true;
      RCLCPP_INFO(
        logger_, "Robot exited zone '%s' (%s) — promoting to LETHAL",
        zone.zone_id.c_str(), zone.reason.c_str());
    }
  }

  // Re-cost areas of removed zones once, so their old LETHAL cells are cleared
  if (has_pending_clear_) {
    *min_x = std::min(*min_x, clear_min_x_);
    *min_y = std::min(*min_y, clear_min_y_);
    *max_x = std::max(*max_x, clear_max_x_);
    *max_y = std::max(*max_y, clear_max_y_);
    has_pending_clear_ = false;
  }

  // Expand bounds to include all zone polygons
  for (const auto & [id, zone] : zones_) {
    if (!zone.is_active) { continue; }

    double zmin_x, zmin_y, zmax_x, zmax_y;
    getPolygonBounds(zone.polygon, zmin_x, zmin_y, zmax_x, zmax_y);

    *min_x = std::min(*min_x, zmin_x);
    *min_y = std::min(*min_y, zmin_y);
    *max_x = std::max(*max_x, zmax_x);
    *max_y = std::max(*max_y, zmax_y);
  }
}

void SemanticKeepoutLayer::updateCosts(
  nav2_costmap_2d::Costmap2D & master_grid,
  int min_i, int min_j,
  int max_i, int max_j)
{
  if (!enabled_) { return; }

  std::lock_guard<std::mutex> lock(zones_mutex_);

  for (const auto & [id, zone] : zones_) {
    if (!zone.is_active) { continue; }

    // Determine cost based on robot-inside-zone status
    unsigned char zone_cost = zone.robot_inside
      ? nav2_costmap_2d::INSCRIBED_INFLATED_OBSTACLE  // 253 — passable but costly
      : nav2_costmap_2d::LETHAL_OBSTACLE;              // 254 — impassable

    // Get zone bounds in costmap cell coordinates
    double zmin_x, zmin_y, zmax_x, zmax_y;
    getPolygonBounds(zone.polygon, zmin_x, zmin_y, zmax_x, zmax_y);

    // Enforce-bounds variant: zones may extend past the map edge (plain
    // worldToMap leaves the indices unset in that case)
    int cell_min_i, cell_min_j, cell_max_i, cell_max_j;
    master_grid.worldToMapEnforceBounds(zmin_x, zmin_y, cell_min_i, cell_min_j);
    master_grid.worldToMapEnforceBounds(zmax_x, zmax_y, cell_max_i, cell_max_j);

    // Clamp to the update window [min, max)
    cell_min_i = std::max(cell_min_i, min_i);
    cell_min_j = std::max(cell_min_j, min_j);
    cell_max_i = std::min(cell_max_i, max_i - 1);
    cell_max_j = std::min(cell_max_j, max_j - 1);

    // Mark cells inside the polygon
    for (int j = cell_min_j; j <= cell_max_j; ++j) {
      for (int i = cell_min_i; i <= cell_max_i; ++i) {
        double wx, wy;
        master_grid.mapToWorld(i, j, wx, wy);

        if (isPointInPolygon(wx, wy, zone.polygon)) {
          unsigned char current_cost = master_grid.getCost(i, j);
          // Only set if our cost is higher (don't overwrite existing lethal obstacles)
          if (zone_cost > current_cost) {
            master_grid.setCost(i, j, zone_cost);
          }
        }
      }
    }
  }
}

void SemanticKeepoutLayer::reset()
{
  std::lock_guard<std::mutex> lock(zones_mutex_);

  // Nav2 calls reset() whenever a costmap is cleared — including from the
  // default behavior tree's recovery branch after a planning failure. Keepout
  // zones are operator intent, not sensor data, so they must survive it:
  // dropping them here let the robot replan straight through "avoided" areas.
  // Zones are removed only via the services or one-shot expiry.
  zones_changed_ = true;
  current_ = true;

  RCLCPP_INFO(
    logger_, "SemanticKeepoutLayer: Reset — keeping %zu keepout zones", zones_.size());
}

// ═══════════════════════════════════════════════════════════════
// SERVICE CALLBACKS
// ═══════════════════════════════════════════════════════════════

void SemanticKeepoutLayer::addZoneCallback(
  const std::shared_ptr<semantic_nav_interfaces::srv::AddKeepoutZone::Request> request,
  std::shared_ptr<semantic_nav_interfaces::srv::AddKeepoutZone::Response> response)
{
  std::lock_guard<std::mutex> lock(zones_mutex_);

  if (request->zone.points.size() < 3) {
    response->success = false;
    response->message = "Polygon must have at least 3 points";
    return;
  }

  ZoneData zone;
  zone.zone_id = generateZoneId();
  zone.zone_group_id = request->zone_group_id;
  zone.reason = request->reason;
  zone.polygon = request->zone;
  zone.duration = request->duration.empty() ? "session" : request->duration;
  zone.ttl_seconds = request->ttl_seconds;
  zone.created_at = std::chrono::steady_clock::now();
  zone.is_active = true;

  // Check if robot is currently inside the new zone
  zone.robot_inside = isPointInPolygon(robot_x_, robot_y_, zone.polygon);
  if (zone.robot_inside) {
    RCLCPP_WARN(
      logger_,
      "Robot is INSIDE newly added zone '%s' (%s). "
      "Marking as INSCRIBED (passable) until robot exits.",
      zone.zone_id.c_str(), zone.reason.c_str());
  }

  // Store zone
  zones_[zone.zone_id] = zone;

  // Track in group
  if (!zone.zone_group_id.empty()) {
    zone_groups_[zone.zone_group_id].insert(zone.zone_id);
  }

  zones_changed_ = true;

  // Publish for frontend
  publishZones();

  response->zone_id = zone.zone_id;
  response->success = true;
  response->message = "Zone added: " + zone.reason;

  RCLCPP_INFO(
    logger_, "Added keepout zone '%s': %s (group: %s, duration: %s, %zu points)",
    zone.zone_id.c_str(), zone.reason.c_str(),
    zone.zone_group_id.c_str(), zone.duration.c_str(),
    zone.polygon.points.size());
}

void SemanticKeepoutLayer::removeZoneCallback(
  const std::shared_ptr<semantic_nav_interfaces::srv::RemoveKeepoutZone::Request> request,
  std::shared_ptr<semantic_nav_interfaces::srv::RemoveKeepoutZone::Response> response)
{
  std::lock_guard<std::mutex> lock(zones_mutex_);

  auto it = zones_.find(request->zone_id);
  if (it == zones_.end()) {
    response->success = false;
    response->message = "Zone not found: " + request->zone_id;
    return;
  }

  // Remove from group
  auto group_it = zone_groups_.find(it->second.zone_group_id);
  if (group_it != zone_groups_.end()) {
    group_it->second.erase(request->zone_id);
    if (group_it->second.empty()) {
      zone_groups_.erase(group_it);
    }
  }

  RCLCPP_INFO(logger_, "Removed keepout zone '%s': %s",
    request->zone_id.c_str(), it->second.reason.c_str());

  markForClear(it->second);
  zones_.erase(it);
  zones_changed_ = true;
  publishZones();

  response->success = true;
  response->message = "Zone removed";
}

void SemanticKeepoutLayer::removeGroupCallback(
  const std::shared_ptr<semantic_nav_interfaces::srv::RemoveZoneGroup::Request> request,
  std::shared_ptr<semantic_nav_interfaces::srv::RemoveZoneGroup::Response> response)
{
  std::lock_guard<std::mutex> lock(zones_mutex_);

  auto group_it = zone_groups_.find(request->zone_group_id);
  if (group_it == zone_groups_.end()) {
    response->success = false;
    response->zones_removed = 0;
    response->message = "Zone group not found: " + request->zone_group_id;
    return;
  }

  int count = 0;
  for (const auto & zone_id : group_it->second) {
    auto zone_it = zones_.find(zone_id);
    if (zone_it != zones_.end()) {
      markForClear(zone_it->second);
      zones_.erase(zone_it);
      count++;
    }
  }

  zone_groups_.erase(group_it);
  zones_changed_ = true;
  publishZones();

  response->success = true;
  response->zones_removed = count;
  response->message = "Removed " + std::to_string(count) + " zones from group";

  RCLCPP_INFO(
    logger_, "Removed zone group '%s': %d zones",
    request->zone_group_id.c_str(), count);
}

// ═══════════════════════════════════════════════════════════════
// HELPER METHODS
// ═══════════════════════════════════════════════════════════════

void SemanticKeepoutLayer::publishZones()
{
  // Caller must hold zones_mutex_
  semantic_nav_interfaces::msg::KeepoutZoneArray snapshot;
  if (auto node = node_.lock()) {
    snapshot.header.stamp = node->now();
  }
  snapshot.header.frame_id = layered_costmap_ ? layered_costmap_->getGlobalFrameID() : "map";

  for (const auto & [id, zone] : zones_) {
    auto msg = semantic_nav_interfaces::msg::KeepoutZone();
    msg.zone_id = zone.zone_id;
    msg.zone_group_id = zone.zone_group_id;
    msg.reason = zone.reason;
    msg.polygon = zone.polygon;
    msg.duration = zone.duration;
    msg.ttl_seconds = zone.ttl_seconds;
    msg.is_active = zone.is_active;
    zone_pub_->publish(msg);
    snapshot.zones.push_back(msg);
  }

  if (zone_list_pub_) {
    zone_list_pub_->publish(snapshot);
  }
}

void SemanticKeepoutLayer::markForClear(const ZoneData & zone)
{
  // Caller must hold zones_mutex_
  double zmin_x, zmin_y, zmax_x, zmax_y;
  getPolygonBounds(zone.polygon, zmin_x, zmin_y, zmax_x, zmax_y);
  if (!has_pending_clear_) {
    clear_min_x_ = zmin_x;
    clear_min_y_ = zmin_y;
    clear_max_x_ = zmax_x;
    clear_max_y_ = zmax_y;
    has_pending_clear_ = true;
  } else {
    clear_min_x_ = std::min(clear_min_x_, zmin_x);
    clear_min_y_ = std::min(clear_min_y_, zmin_y);
    clear_max_x_ = std::max(clear_max_x_, zmax_x);
    clear_max_y_ = std::max(clear_max_y_, zmax_y);
  }
}

bool SemanticKeepoutLayer::isPointInPolygon(
  double x, double y,
  const geometry_msgs::msg::Polygon & polygon) const
{
  // Ray-casting algorithm
  int n = polygon.points.size();
  if (n < 3) { return false; }

  bool inside = false;
  for (int i = 0, j = n - 1; i < n; j = i++) {
    double xi = polygon.points[i].x, yi = polygon.points[i].y;
    double xj = polygon.points[j].x, yj = polygon.points[j].y;

    if (((yi > y) != (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi))
    {
      inside = !inside;
    }
  }
  return inside;
}

void SemanticKeepoutLayer::getPolygonBounds(
  const geometry_msgs::msg::Polygon & polygon,
  double & min_x, double & min_y,
  double & max_x, double & max_y) const
{
  min_x = min_y = std::numeric_limits<double>::max();
  max_x = max_y = std::numeric_limits<double>::lowest();

  for (const auto & p : polygon.points) {
    min_x = std::min(min_x, static_cast<double>(p.x));
    min_y = std::min(min_y, static_cast<double>(p.y));
    max_x = std::max(max_x, static_cast<double>(p.x));
    max_y = std::max(max_y, static_cast<double>(p.y));
  }
}

void SemanticKeepoutLayer::expireZones()
{
  auto now = std::chrono::steady_clock::now();
  std::vector<std::string> expired;

  for (const auto & [id, zone] : zones_) {
    if (zone.duration == "one_shot" && zone.ttl_seconds > 0) {
      auto elapsed = std::chrono::duration<double>(now - zone.created_at).count();
      if (elapsed >= zone.ttl_seconds) {
        expired.push_back(id);
      }
    }
  }

  for (const auto & id : expired) {
    RCLCPP_INFO(logger_, "One-shot zone '%s' expired", id.c_str());
    auto it = zones_.find(id);
    if (it != zones_.end()) {
      auto group_it = zone_groups_.find(it->second.zone_group_id);
      if (group_it != zone_groups_.end()) {
        group_it->second.erase(id);
        if (group_it->second.empty()) {
          zone_groups_.erase(group_it);
        }
      }
      markForClear(it->second);
      zones_.erase(it);
    }
  }

  if (!expired.empty()) {
    zones_changed_ = true;
    publishZones();
  }
}

std::string SemanticKeepoutLayer::generateZoneId()
{
  std::ostringstream oss;
  oss << "zone_" << zone_counter_++;
  return oss.str();
}

}  // namespace semantic_keepout_layer
