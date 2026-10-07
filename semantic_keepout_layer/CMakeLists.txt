cmake_minimum_required(VERSION 3.8)
project(semantic_keepout_layer)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(nav2_costmap_2d REQUIRED)
find_package(pluginlib REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(semantic_nav_interfaces REQUIRED)
find_package(tf2 REQUIRED)
find_package(tf2_geometry_msgs REQUIRED)
find_package(tf2_ros REQUIRED)

# Shared library for the costmap plugin
add_library(semantic_keepout_layer SHARED
  src/semantic_keepout_layer.cpp
)

target_include_directories(semantic_keepout_layer PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>
)

ament_target_dependencies(semantic_keepout_layer
  rclcpp
  nav2_costmap_2d
  pluginlib
  geometry_msgs
  semantic_nav_interfaces
  tf2
  tf2_geometry_msgs
  tf2_ros
)

# Export plugin description for pluginlib
pluginlib_export_plugin_description_file(nav2_costmap_2d semantic_keepout_layer.xml)

install(TARGETS semantic_keepout_layer
  ARCHIVE DESTINATION lib
  LIBRARY DESTINATION lib
  RUNTIME DESTINATION bin
)

install(DIRECTORY include/
  DESTINATION include
)

install(FILES semantic_keepout_layer.xml
  DESTINATION share/${PROJECT_NAME}
)

if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  set(ament_cmake_copyright_FOUND TRUE)
  set(ament_cmake_cpplint_FOUND TRUE)
  ament_lint_auto_find_test_dependencies()
endif()

ament_export_include_directories(include)
ament_export_libraries(semantic_keepout_layer)
ament_export_dependencies(
  rclcpp
  nav2_costmap_2d
  pluginlib
  geometry_msgs
  semantic_nav_interfaces
)

ament_package()
