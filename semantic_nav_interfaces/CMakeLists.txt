cmake_minimum_required(VERSION 3.8)
project(semantic_nav_interfaces)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(std_msgs REQUIRED)
find_package(builtin_interfaces REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/LabelGeometry.msg"
  "msg/LabelEntry.msg"
  "msg/LabelArray.msg"
  "msg/NavigationIntent.msg"
  "msg/DialogueEvent.msg"
  "msg/KeepoutZone.msg"
  "msg/KeepoutZoneArray.msg"
  "msg/SystemStatus.msg"
  "msg/ViewerCamera.msg"
  "msg/ViewerCameraState.msg"
  "srv/AddKeepoutZone.srv"
  "srv/RemoveKeepoutZone.srv"
  "srv/RemoveZoneGroup.srv"
  "srv/AddLabel.srv"
  "srv/RemoveLabel.srv"
  "srv/GetLabels.srv"
  "srv/UpdateLabel.srv"
  "srv/ResolveTarget.srv"
  "srv/ProcessCommand.srv"
  "srv/SaveMap.srv"
  DEPENDENCIES geometry_msgs std_msgs builtin_interfaces
)

if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  ament_lint_auto_find_test_dependencies()
endif()

ament_package()
