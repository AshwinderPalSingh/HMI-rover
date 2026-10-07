cmake_minimum_required(VERSION 3.8)
project(semantic_nav_gazebo)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra)
endif()

find_package(ament_cmake REQUIRED)
find_package(gazebo_dev REQUIRED)
find_package(gazebo_ros REQUIRED)
find_package(rclcpp REQUIRED)
find_package(semantic_nav_interfaces REQUIRED)

# Orbit camera that follows the robot; driven by the console over /viewer_camera/command
add_library(viewer_camera_plugin SHARED src/viewer_camera_plugin.cpp)
ament_target_dependencies(viewer_camera_plugin gazebo_dev gazebo_ros rclcpp semantic_nav_interfaces)

install(TARGETS viewer_camera_plugin LIBRARY DESTINATION lib)

ament_package()
