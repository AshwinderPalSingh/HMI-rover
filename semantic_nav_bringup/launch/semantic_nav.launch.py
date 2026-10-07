"""
Full system launch file for Semantic Keep-Out Navigation.

Launches:
  1. The existing robot simulation (Gazebo + Nav2 + SLAM) via v5 launch
  2. Web HMI infrastructure: rosbridge_server, rosapi (introspection),
     teleop guard (deadman for browser teleop), HMI static server
  3. All semantic nav backend nodes

Operator console: http://localhost:8080 (after `npm run build` in src/semantic_nav_hmi)
"""

import os
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, UnsetEnvironmentVariable
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.substitutions import FindPackageShare
from ament_index_python.packages import get_package_share_directory


def generate_launch_description():
    # Package paths
    pkg_basic_robot = get_package_share_directory('basic_mobile_robot')
    pkg_semantic_nav = get_package_share_directory('semantic_nav_bringup')

    # Config
    semantic_nav_params = os.path.join(pkg_semantic_nav, 'config', 'semantic_nav_params.yaml')

    # Launch arguments
    use_sim_time = LaunchConfiguration('use_sim_time')
    slam = LaunchConfiguration('slam')
    use_rviz = LaunchConfiguration('use_rviz')
    headless = LaunchConfiguration('headless')
    rosbridge_port = LaunchConfiguration('rosbridge_port')
    hmi_port = LaunchConfiguration('hmi_port')

    declare_use_sim_time = DeclareLaunchArgument(
        'use_sim_time', default_value='True',
        description='Use simulation clock'
    )

    declare_slam = DeclareLaunchArgument(
        'slam', default_value='False',
        description='Whether to run SLAM (True) or localization (False)'
    )

    declare_use_rviz = DeclareLaunchArgument(
        'use_rviz', default_value='True',
        description='Start RViz alongside the web HMI'
    )

    declare_headless = DeclareLaunchArgument(
        'headless', default_value='False',
        description='Run Gazebo without the gzclient window'
    )

    declare_rosbridge_port = DeclareLaunchArgument(
        'rosbridge_port', default_value='9090',
        description='WebSocket port for rosbridge (advertised to the HMI)'
    )

    declare_hmi_port = DeclareLaunchArgument(
        'hmi_port', default_value='8080',
        description='HTTP port for the operator console'
    )

    # ── 1. Include the existing robot launch (v5) ──
    robot_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(pkg_basic_robot, 'launch', 'basic_mobile_bot_v5.launch.py')
        ),
        launch_arguments={
            'use_sim_time': use_sim_time,
            'slam': slam,
            'use_rviz': use_rviz,
            'headless': headless,
        }.items()
    )

    # ── 2. Web HMI infrastructure ──
    rosbridge_node = Node(
        package='rosbridge_server',
        executable='rosbridge_websocket',
        name='rosbridge_websocket',
        output='screen',
        parameters=[{
            'port': ParameterValue(rosbridge_port, value_type=int),
            'address': '',
            'retry_startup_delay': 5.0,
            # Outgoing messages above max_message_size get fragmented, and rosbridge
            # cannot fragment CBOR — a 2048x2048 map (~4 MB) would be dropped silently
            'max_message_size': 20000000,
            # Don't let one slow/missing service or action stall the whole socket
            'call_services_in_new_thread': True,
            'send_action_goals_in_new_thread': True,
            'default_call_service_timeout': 10.0,
        }],
    )

    # Topic/node introspection for the HMI's System panel
    rosapi_node = Node(
        package='rosapi',
        executable='rosapi_node',
        name='rosapi',
        output='screen',
    )

    # Deadman between browser teleop (/hmi/cmd_vel) and the base (/cmd_vel)
    teleop_guard_node = Node(
        package='semantic_nav_bringup',
        executable='teleop_guard_node',
        name='teleop_guard',
        output='screen',
        parameters=[{
            'input_topic': '/hmi/cmd_vel',
            'output_topic': '/cmd_vel',
            'timeout': 0.5,
            'max_linear': 0.5,
            'max_angular': 1.5,
        }],
    )

    # Serves the built operator console (src/semantic_nav_hmi/dist)
    hmi_server_node = Node(
        package='semantic_nav_bringup',
        executable='hmi_server_node',
        name='hmi_server',
        output='screen',
        parameters=[{
            'port': ParameterValue(hmi_port, value_type=int),
            'rosbridge_port': ParameterValue(rosbridge_port, value_type=int),
        }],
    )

    # ── 3. Semantic Nav backend nodes ──
    label_db_node = Node(
        package='semantic_nav_bringup',
        executable='label_db_node',
        name='label_db_node',
        output='screen',
        parameters=[semantic_nav_params, {'use_sim_time': use_sim_time}],
    )

    intent_parser_node = Node(
        package='semantic_nav_bringup',
        executable='intent_parser_node',
        name='intent_parser_node',
        output='screen',
        parameters=[semantic_nav_params, {'use_sim_time': use_sim_time}],
    )

    target_resolver_node = Node(
        package='semantic_nav_bringup',
        executable='target_resolver_node',
        name='target_resolver_node',
        output='screen',
        parameters=[semantic_nav_params, {'use_sim_time': use_sim_time}],
    )

    dialogue_manager_node = Node(
        package='semantic_nav_bringup',
        executable='dialogue_manager_node',
        name='dialogue_manager_node',
        output='screen',
        parameters=[semantic_nav_params, {'use_sim_time': use_sim_time}],
    )

    navigation_executor_node = Node(
        package='semantic_nav_bringup',
        executable='navigation_executor_node',
        name='navigation_executor_node',
        output='screen',
        parameters=[semantic_nav_params, {'use_sim_time': use_sim_time}],
    )

    return LaunchDescription([
        # slam_toolbox treats a set SNAP_COMMON as "running inside a snap" and
        # rewrites save paths under $SNAP_COMMON, so saving the pose graph fails
        # when launched from a snap app's terminal (e.g. VS Code installed as a snap)
        UnsetEnvironmentVariable('SNAP_COMMON'),
        declare_use_sim_time,
        declare_slam,
        declare_use_rviz,
        declare_headless,
        declare_rosbridge_port,
        declare_hmi_port,
        robot_launch,
        rosbridge_node,
        rosapi_node,
        teleop_guard_node,
        hmi_server_node,
        label_db_node,
        intent_parser_node,
        target_resolver_node,
        dialogue_manager_node,
        navigation_executor_node,
    ])
