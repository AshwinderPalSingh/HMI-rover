// Orbit viewer camera for the operator console's 3D view (Gazebo classic model plugin).
//
// Attach to a gravity-free kinematic model that carries a camera sensor. Every physics
// step the model is placed on a sphere around a target point near the robot, looking
// at it — the Gazebo GUI's orbit view, but following the robot. Updating in the physics
// loop keeps the camera locked to the robot with no judder, as if it were mounted on it.
//
// The target is given relative to the ground point under the robot (the bottom of its
// collision bounding box), so z = 0 is the ground — what the console assumes when it
// maps the pointer onto the ground — and the camera keeps its height on slopes.
//
// ROS interface (namespace from <ros><namespace>, e.g. /viewer_camera):
//   command  semantic_nav_interfaces/ViewerCamera       new view; distance <= 0 resets to the default
//   state    semantic_nav_interfaces/ViewerCameraState  current view (transient local), stamped with
//            the simulation time it took effect, so the console can tell which view each frame shows
//
// SDF parameters: <target> model name, <azimuth> <elevation> <distance> <offset> <follow_heading>
// default view, <heading_lag> time constant (s) of the heading smoothing in follow mode.
// The default target sits above the robot, so orbiting keeps the robot centred left-right
// with the view ahead of it in the upper part of the picture.

#include <algorithm>
#include <cmath>
#include <memory>
#include <mutex>
#include <string>

#include <gazebo/common/Events.hh>
#include <gazebo/common/Plugin.hh>
#include <gazebo/physics/Model.hh>
#include <gazebo/physics/World.hh>
#include <gazebo_ros/conversions/builtin_interfaces.hpp>
#include <gazebo_ros/node.hpp>
#include <ignition/math/Pose3.hh>
#include <ignition/math/Vector3.hh>
#include <rclcpp/rclcpp.hpp>
#include <semantic_nav_interfaces/msg/viewer_camera.hpp>
#include <semantic_nav_interfaces/msg/viewer_camera_state.hpp>

namespace semantic_nav_gazebo
{

using ViewerCamera = semantic_nav_interfaces::msg::ViewerCamera;
using ViewerCameraState = semantic_nav_interfaces::msg::ViewerCameraState;

namespace
{
double wrap(double a)
{
  return std::atan2(std::sin(a), std::cos(a));
}

void rotate(ViewerCamera & v, double angle)
{
  const double c = std::cos(angle), s = std::sin(angle);
  const double x = v.offset.x, y = v.offset.y;
  v.offset.x = c * x - s * y;
  v.offset.y = s * x + c * y;
  v.azimuth = wrap(v.azimuth + angle);
}

/** Horizontal field of view of the first camera sensor in the model (SDF default if none). */
double cameraFov(const sdf::ElementPtr & model)
{
  for (auto link = model->HasElement("link") ? model->GetElement("link") : nullptr; link;
    link = link->GetNextElement("link"))
  {
    for (auto sensor = link->HasElement("sensor") ? link->GetElement("sensor") : nullptr; sensor;
      sensor = sensor->GetNextElement("sensor"))
    {
      if (sensor->Get<std::string>("type") == "camera" && sensor->HasElement("camera")) {
        return sensor->GetElement("camera")->Get<double>("horizontal_fov");
      }
    }
  }
  return 1.047;
}
}  // namespace

class ViewerCameraPlugin : public gazebo::ModelPlugin
{
public:
  void Load(gazebo::physics::ModelPtr model, sdf::ElementPtr sdf) override
  {
    model_ = model;
    world_ = model->GetWorld();
    target_name_ = sdf->Get<std::string>("target", "basic_mobile_bot").first;
    heading_lag_ = std::max(0.0, sdf->Get<double>("heading_lag", 0.12).first);
    fov_ = cameraFov(model->GetSDF());

    default_.azimuth = sdf->Get<double>("azimuth", 0.0).first;
    default_.elevation = sdf->Get<double>("elevation", 0.3).first;
    default_.distance = sdf->Get<double>("distance", 2.8).first;
    const auto offset = sdf->Get<ignition::math::Vector3d>(
      "offset", ignition::math::Vector3d(0.0, 0.0, 0.8)).first;
    default_.offset.x = offset.X();
    default_.offset.y = offset.Y();
    default_.offset.z = offset.Z();
    default_.follow_heading = sdf->Get<bool>("follow_heading", true).first;
    view_ = default_;

    ros_ = gazebo_ros::Node::Get(sdf);
    state_pub_ = ros_->create_publisher<ViewerCameraState>(
      "state", rclcpp::QoS(1).transient_local().reliable());
    command_sub_ = ros_->create_subscription<ViewerCamera>(
      "command", 10, std::bind(&ViewerCameraPlugin::OnCommand, this, std::placeholders::_1));
    Publish(view_, world_->SimTime());

    update_ = gazebo::event::Events::ConnectWorldUpdateBegin(
      std::bind(&ViewerCameraPlugin::OnUpdate, this, std::placeholders::_1));
    RCLCPP_INFO(
      ros_->get_logger(), "Viewer camera '%s' orbiting '%s' (fov %.2f rad, commands on %s)",
      model_->GetName().c_str(), target_name_.c_str(), fov_, command_sub_->get_topic_name());
  }

private:
  void OnCommand(const ViewerCamera::SharedPtr msg)
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (msg->distance <= 0.0) {
      view_ = default_;
    } else {
      ViewerCamera v = *msg;
      // Switching between robot-relative and world-fixed: re-express the view in the
      // new frame so the picture does not jump.
      if (v.follow_heading != view_.follow_heading && have_heading_) {
        rotate(v, v.follow_heading ? -heading_ : heading_);
      }
      v.azimuth = wrap(v.azimuth);
      v.distance = std::clamp(v.distance, 0.4, 60.0);
      v.offset.x = std::clamp(v.offset.x, -80.0, 80.0);
      v.offset.y = std::clamp(v.offset.y, -80.0, 80.0);
      v.offset.z = std::clamp(v.offset.z, -5.0, 20.0);
      // never below the ground (10 cm margin)
      const double lowest =
        std::max(-0.1, std::asin(std::clamp((0.1 - v.offset.z) / v.distance, -1.0, 1.0)));
      v.elevation = std::clamp(v.elevation, std::min(lowest, 1.5), 1.5);
      view_ = v;
    }
    // reported from the physics loop, stamped with the step that first shows it
    changed_ = true;
  }

  void OnUpdate(const gazebo::common::UpdateInfo & info)
  {
    // The robot may be spawned after the world loads, or respawned: look it up by name
    // while missing, and refresh the handle now and then.
    if (!target_ || ++lookups_ % 2000 == 0) {
      const bool found = target_ != nullptr;
      target_ = world_->ModelByName(target_name_);
      if (!target_) {
        return;
      }
      if (!found) {
        std::lock_guard<std::mutex> lock(mutex_);
        changed_ = true;  // report the robot's size as soon as it is known
      }
    }
    const ignition::math::Pose3d robot = target_->WorldPose();
    // height of the robot's origin above the ground it stands on, and its size (10 Hz is plenty)
    if (lookups_ % 100 == 1 || !have_heading_) {
      const auto box = target_->BoundingBox();
      clearance_ = robot.Pos().Z() - box.Min().Z();
      radius_ = 0.5 * std::hypot(box.XLength(), box.YLength());
      height_ = box.ZLength();
    }
    const double yaw = robot.Rot().Yaw();
    const double now = info.simTime.Double();

    ViewerCamera v;
    double heading;
    bool changed;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      // Follow the robot's heading through a short first-order lag: turns read clearly
      // and small yaw wobble does not shake the whole picture.
      const double dt = now - last_time_;
      if (!have_heading_ || dt < 0.0 || dt > 1.0 || heading_lag_ <= 0.0) {
        heading_ = yaw;
      } else {
        heading_ = wrap(heading_ + (1.0 - std::exp(-dt / heading_lag_)) * wrap(yaw - heading_));
      }
      have_heading_ = true;
      last_time_ = now;
      v = view_;
      heading = v.follow_heading ? heading_ : 0.0;
      changed = changed_;
      changed_ = false;
    }

    const double ch = std::cos(heading), sh = std::sin(heading);
    const auto & p = robot.Pos();
    const double tx = p.X() + ch * v.offset.x - sh * v.offset.y;
    const double ty = p.Y() + sh * v.offset.x + ch * v.offset.y;
    const double tz = p.Z() - clearance_ + v.offset.z;
    const double look = heading + v.azimuth;
    const double ce = std::cos(v.elevation), se = std::sin(v.elevation);
    // Positive pitch looks down in Gazebo's x-forward, z-up camera frame
    model_->SetWorldPose(
      ignition::math::Pose3d(
        tx - v.distance * ce * std::cos(look), ty - v.distance * ce * std::sin(look),
        tz + v.distance * se, 0.0, v.elevation, look));

    if (changed) {
      Publish(v, info.simTime);
    }
  }

  void Publish(const ViewerCamera & v, const gazebo::common::Time & stamp)
  {
    ViewerCameraState state;
    state.header.stamp = gazebo_ros::Convert<builtin_interfaces::msg::Time>(stamp);
    state.header.frame_id = v.follow_heading ? target_name_ : "world";
    state.view = v;
    state.horizontal_fov = fov_;
    state.target_radius = radius_;
    state.target_height = height_;
    state_pub_->publish(state);
  }

  gazebo::physics::ModelPtr model_;
  gazebo::physics::WorldPtr world_;
  gazebo::physics::ModelPtr target_;
  std::string target_name_;
  unsigned lookups_ = 0;
  double fov_ = 1.047;

  gazebo_ros::Node::SharedPtr ros_;
  rclcpp::Publisher<ViewerCameraState>::SharedPtr state_pub_;
  rclcpp::Subscription<ViewerCamera>::SharedPtr command_sub_;
  gazebo::event::ConnectionPtr update_;

  std::mutex mutex_;
  ViewerCamera default_;
  ViewerCamera view_;
  bool changed_ = false;
  double heading_lag_ = 0.12;
  double heading_ = 0.0;
  bool have_heading_ = false;
  double last_time_ = 0.0;
  double clearance_ = 0.0;
  double radius_ = 0.0;
  double height_ = 0.0;
};

GZ_REGISTER_MODEL_PLUGIN(ViewerCameraPlugin)

}  // namespace semantic_nav_gazebo
