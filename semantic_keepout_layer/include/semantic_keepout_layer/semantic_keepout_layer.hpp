#ifndef SEMANTIC_KEEPOUT_LAYER__SEMANTIC_KEEPOUT_LAYER_HPP_
#define SEMANTIC_KEEPOUT_LAYER__SEMANTIC_KEEPOUT_LAYER_HPP_

#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <mutex>
#include <chrono>

#include "rclcpp/rclcpp.hpp"
#include "nav2_costmap_2d/layer.hpp"
#include "nav2_costmap_2d/costmap_layer.hpp"
#include "nav2_costmap_2d/layered_costmap.hpp"
#include "geometry_msgs/msg/polygon.hpp"
#include "geometry_msgs/msg/point32.hpp"
#include "semantic_nav_interfaces/srv/add_keepout_zone.hpp"
#include "semantic_nav_interfaces/srv/remove_keepout_zone.hpp"
#include "semantic_nav_interfaces/srv/remove_zone_group.hpp"
#include "semantic_nav_interfaces/msg/keepout_zone.hpp"
#include "semantic_nav_interfaces/msg/keepout_zone_array.hpp"

namespace semantic_keepout_layer
{

/**
 * Internal zone data representation
 */
struct ZoneData
{
  std::string zone_id;
  std::string zone_group_id;
  std::string reason;
  geometry_msgs::msg::Polygon polygon;
  std::string duration;  // "session", "permanent", "one_shot"
  double ttl_seconds;
  std::chrono::steady_clock::time_point created_at;
  bool is_active;
  bool robot_inside;  // True if robot was inside zone when it was added
};

/**
 * @class SemanticKeepoutLayer
 * @brief Nav2 costmap layer that manages dynamic keepout zones at runtime.
 *
 * Zones are added/removed via ROS 2 services:
 *   - /add_keepout_zone
 *   - /remove_keepout_zone
 *   - /remove_zone_group
 *
 * Key features:
 *   - Robot-inside-zone safety: marks cells as INSCRIBED (not LETHAL) if robot is inside
 *   - Zone groups: batch add/remove for category commands
 *   - TTL support: session, permanent, one-shot with auto-expiry
 */
class SemanticKeepoutLayer : public nav2_costmap_2d::CostmapLayer
{
public:
  SemanticKeepoutLayer();

  void onInitialize() override;
  void updateBounds(
    double robot_x, double robot_y, double robot_yaw,
    double * min_x, double * min_y,
    double * max_x, double * max_y) override;
  void updateCosts(
    nav2_costmap_2d::Costmap2D & master_grid,
    int min_i, int min_j,
    int max_i, int max_j) override;
  void reset() override;
  bool isClearable() override { return true; }

private:
  // Service callbacks
  void addZoneCallback(
    const std::shared_ptr<semantic_nav_interfaces::srv::AddKeepoutZone::Request> request,
    std::shared_ptr<semantic_nav_interfaces::srv::AddKeepoutZone::Response> response);

  void removeZoneCallback(
    const std::shared_ptr<semantic_nav_interfaces::srv::RemoveKeepoutZone::Request> request,
    std::shared_ptr<semantic_nav_interfaces::srv::RemoveKeepoutZone::Response> response);

  void removeGroupCallback(
    const std::shared_ptr<semantic_nav_interfaces::srv::RemoveZoneGroup::Request> request,
    std::shared_ptr<semantic_nav_interfaces::srv::RemoveZoneGroup::Response> response);

  // Zone publishers for frontend visualization (per-zone stream + full snapshot)
  void publishZones();

  // Remember the bounds of a removed zone so the next update re-costs that area
  void markForClear(const ZoneData & zone);

  // Geometry helpers
  bool isPointInPolygon(double x, double y, const geometry_msgs::msg::Polygon & polygon) const;
  void getPolygonBounds(
    const geometry_msgs::msg::Polygon & polygon,
    double & min_x, double & min_y, double & max_x, double & max_y) const;

  // Check and expire one-shot zones
  void expireZones();

  // Generate unique zone ID
  std::string generateZoneId();

  // Data members
  std::unordered_map<std::string, ZoneData> zones_;
  std::unordered_map<std::string, std::unordered_set<std::string>> zone_groups_;
  std::mutex zones_mutex_;

  // Service servers
  rclcpp::Service<semantic_nav_interfaces::srv::AddKeepoutZone>::SharedPtr add_zone_srv_;
  rclcpp::Service<semantic_nav_interfaces::srv::RemoveKeepoutZone>::SharedPtr remove_zone_srv_;
  rclcpp::Service<semantic_nav_interfaces::srv::RemoveZoneGroup>::SharedPtr remove_group_srv_;

  // Zone publishers
  rclcpp::Publisher<semantic_nav_interfaces::msg::KeepoutZone>::SharedPtr zone_pub_;
  rclcpp::Publisher<semantic_nav_interfaces::msg::KeepoutZoneArray>::SharedPtr zone_list_pub_;

  // Bounds of removed zones still to be re-costed (cells outside the normal
  // update window would otherwise keep their stale LETHAL cost)
  bool has_pending_clear_;
  double clear_min_x_, clear_min_y_, clear_max_x_, clear_max_y_;

  // Robot position (updated each cycle)
  double robot_x_, robot_y_;

  // Zone ID counter
  int zone_counter_;

  // Flag to indicate zones have changed and bounds need updating
  bool zones_changed_;
};

}  // namespace semantic_keepout_layer

#endif  // SEMANTIC_KEEPOUT_LAYER__SEMANTIC_KEEPOUT_LAYER_HPP_
