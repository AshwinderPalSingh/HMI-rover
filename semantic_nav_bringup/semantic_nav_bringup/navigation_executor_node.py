"""
Navigation Executor Node — Bridges resolved commands to Nav2 and costmap services.

Responsibilities:
  - navigate_to → sends NavigateToPose action goal to Nav2
  - avoid_zone  → calls /add_keepout_zone service on costmap layer
  - clear_zone  → calls /remove_keepout_zone or /remove_zone_group
  - cancel      → cancels current Nav2 goal
  - Monitors Nav2 feedback and publishes status
"""

import math

import rclpy
from rclpy.node import Node
from rclpy.action import ActionClient
from rclpy.qos import QoSProfile, QoSDurabilityPolicy, QoSReliabilityPolicy

from std_msgs.msg import String
from geometry_msgs.msg import PoseStamped, Polygon, Point32
from nav2_msgs.action import NavigateToPose
from semantic_nav_interfaces.msg import NavigationIntent, DialogueEvent, LabelArray
from semantic_nav_interfaces.srv import AddKeepoutZone, RemoveZoneGroup
from semantic_nav_bringup.text_utils import category_matches


class NavigationExecutorNode(Node):
    """Executes fully resolved navigation commands."""

    def __init__(self):
        super().__init__('navigation_executor_node')

        # Action client for Nav2
        self.nav_client = ActionClient(self, NavigateToPose, 'navigate_to_pose')
        self.current_goal_handle = None

        # Service clients
        self.add_zone_client = self.create_client(AddKeepoutZone, '/add_keepout_zone')
        self.remove_group_client = self.create_client(RemoveZoneGroup, '/remove_zone_group')

        # Label cache mirrored from the latched /label_list snapshot
        # (avoids sync service deadlocks; deletions propagate)
        self.label_cache = {}  # label_id → LabelEntry
        snapshot_qos = QoSProfile(
            depth=1,
            durability=QoSDurabilityPolicy.TRANSIENT_LOCAL,
            reliability=QoSReliabilityPolicy.RELIABLE,
        )
        self.labels_sub = self.create_subscription(
            LabelArray, '/label_list', self._label_list_cb, snapshot_qos
        )

        # Subscriber
        self.command_sub = self.create_subscription(
            NavigationIntent, '/execute_command', self._command_cb, 10
        )

        # Publishers
        self.status_pub = self.create_publisher(String, '/nav_execution_status', 10)
        self.dialogue_pub = self.create_publisher(DialogueEvent, '/dialogue_events', 10)

        self.get_logger().info('Navigation Executor ready')

    def _label_list_cb(self, msg):
        """Replace the label cache with the latest snapshot from the label DB node."""
        self.label_cache = {label.label_id: label for label in msg.labels}

    def _command_cb(self, msg):
        """Handle incoming fully-resolved commands."""
        if msg.action == 'navigate_to':
            self._navigate_to(msg)
        elif msg.action == 'avoid_zone':
            self._avoid_zone(msg)
        elif msg.action == 'clear_zone':
            self._clear_zone(msg)
        elif msg.action == 'cancel':
            self._cancel_navigation()

    def _navigate_to(self, intent):
        """Send a navigation goal to Nav2."""
        # Look up label coordinates
        label = self._get_label_by_name(intent.target)
        if not label:
            self._publish_status('failed')
            self._publish_dialogue(
                'failed',
                f'Could not find coordinates for "{intent.target}"'
            )
            return

        goal_x = label.geometry.x
        goal_y = label.geometry.y

        self.get_logger().info(
            f'Navigating to "{intent.target}" at ({goal_x:.2f}, {goal_y:.2f})'
        )

        # Wait for Nav2 action server
        if not self.nav_client.wait_for_server(timeout_sec=5.0):
            self._publish_status('failed')
            self._publish_dialogue('failed', 'Nav2 action server not available')
            return

        # Create goal
        goal = NavigateToPose.Goal()
        goal.pose = PoseStamped()
        goal.pose.header.frame_id = 'map'
        goal.pose.header.stamp = self.get_clock().now().to_msg()
        goal.pose.pose.position.x = goal_x
        goal.pose.pose.position.y = goal_y
        goal.pose.pose.position.z = 0.0
        goal.pose.pose.orientation.w = 1.0  # Face forward

        # Send goal
        send_future = self.nav_client.send_goal_async(
            goal, feedback_callback=self._nav_feedback_cb
        )
        send_future.add_done_callback(self._nav_goal_response_cb)

        self._publish_status('navigating')
        self._publish_dialogue(
            'executing',
            f'Navigating to {intent.target}...'
        )

    def _nav_goal_response_cb(self, future):
        """Handle Nav2 goal acceptance/rejection."""
        goal_handle = future.result()
        if not goal_handle.accepted:
            self.get_logger().warn('Navigation goal rejected by Nav2')
            self._publish_status('failed')
            self._publish_dialogue('failed', 'Navigation goal was rejected')
            return

        self.current_goal_handle = goal_handle
        result_future = goal_handle.get_result_async()
        result_future.add_done_callback(self._nav_result_cb)

    def _nav_feedback_cb(self, feedback_msg):
        """Handle Nav2 navigation feedback."""
        feedback = feedback_msg.feedback
        # Could extract distance remaining, ETA, etc.
        # For now just log it
        pass

    def _nav_result_cb(self, future):
        """Handle Nav2 navigation result."""
        result = future.result()
        status = result.status

        if status == 4:  # SUCCEEDED
            self._publish_status('completed')
            self._publish_dialogue('completed', 'Arrived at destination!')
        elif status == 5:  # CANCELED
            self._publish_status('cancelled')
            self._publish_dialogue('cancelled', 'Navigation cancelled')
        else:
            self._publish_status('failed')
            self._publish_dialogue('failed', f'Navigation failed (status: {status})')

        self.current_goal_handle = None

    def _avoid_zone(self, intent):
        """Add a keepout zone for the target label(s)."""
        if intent.is_category:
            labels = self._get_labels_by_type(intent.target)
        else:
            label = self._get_label_by_name(intent.target)
            labels = [label] if label else []

        if not labels:
            self._publish_dialogue(
                'failed',
                f'No labels found for "{intent.target}"'
            )
            return

        zone_group_id = f'group_{intent.target.replace(" ", "_").lower()}'

        for label in labels:
            polygon = self._label_to_polygon(label)
            if not polygon:
                continue

            if self.add_zone_client.wait_for_service(timeout_sec=2.0):
                request = AddKeepoutZone.Request()
                request.zone = polygon
                request.reason = f'avoid {label.display_name}'
                request.zone_group_id = zone_group_id
                request.duration = intent.duration
                request.ttl_seconds = 0.0

                future = self.add_zone_client.call_async(request)
                future.add_done_callback(
                    lambda f, name=label.display_name: self._zone_added_cb(f, name)
                )
            else:
                self.get_logger().error('add_keepout_zone service not available')

        self._publish_dialogue(
            'executing',
            f'Adding keepout zone for {intent.target}'
        )

    def _zone_added_cb(self, future, label_name):
        """Handle zone addition result."""
        try:
            result = future.result()
            if result.success:
                self.get_logger().info(f'Zone added for "{label_name}": {result.zone_id}')
                self._publish_dialogue(
                    'completed',
                    f'Now avoiding {label_name}'
                )
            else:
                self.get_logger().warn(f'Failed to add zone: {result.message}')
        except Exception as e:
            self.get_logger().error(f'Zone service call failed: {e}')

    def _clear_zone(self, intent):
        """Remove keepout zone(s) for a target."""
        zone_group_id = f'group_{intent.target.replace(" ", "_").lower()}'

        if self.remove_group_client.wait_for_service(timeout_sec=2.0):
            request = RemoveZoneGroup.Request()
            request.zone_group_id = zone_group_id

            future = self.remove_group_client.call_async(request)
            future.add_done_callback(
                lambda f: self._zone_removed_cb(f, intent.target)
            )
        else:
            self._publish_dialogue('failed', 'remove_zone_group service not available')

    def _zone_removed_cb(self, future, target_name):
        """Handle zone removal result."""
        try:
            result = future.result()
            if result.success:
                self._publish_dialogue(
                    'completed',
                    f'Cleared keepout zone for {target_name} '
                    f'({result.zones_removed} zones removed)'
                )
            else:
                self._publish_dialogue('failed', f'No zones found for {target_name}')
        except Exception as e:
            self.get_logger().error(f'Zone removal failed: {e}')

    def _cancel_navigation(self):
        """Cancel current Nav2 goal."""
        if self.current_goal_handle:
            self.get_logger().info('Cancelling navigation')
            self.current_goal_handle.cancel_goal_async()
            self._publish_status('cancelled')
            self._publish_dialogue('cancelled', 'Navigation cancelled')
        else:
            self._publish_dialogue('cancelled', 'No active navigation to cancel')

    def _get_label_by_name(self, name):
        """Look up a label by display name from local cache."""
        name_lower = name.lower()
        for label in self.label_cache.values():
            if label.display_name.lower() == name_lower:
                return label
            # Also check aliases
            for alias in label.aliases:
                if alias.lower() == name_lower:
                    return label
        return None

    def _get_labels_by_type(self, semantic_type):
        """Look up labels by semantic type from local cache."""
        return [
            label for label in self.label_cache.values()
            if category_matches(label.semantic_type, semantic_type)
        ]

    def _label_to_polygon(self, label):
        """Convert a label's geometry to a Polygon for the costmap layer."""
        polygon = Polygon()

        if label.geometry.type == 'point_radius':
            # Create a regular polygon (octagon) from point + radius
            num_sides = 8
            for i in range(num_sides):
                angle = 2 * math.pi * i / num_sides
                point = Point32()
                point.x = float(label.geometry.x + label.geometry.radius * math.cos(angle))
                point.y = float(label.geometry.y + label.geometry.radius * math.sin(angle))
                point.z = 0.0
                polygon.points.append(point)

        elif label.geometry.type == 'polygon' and label.geometry.polygon_points:
            for p in label.geometry.polygon_points:
                point = Point32()
                point.x = float(p.x)
                point.y = float(p.y)
                point.z = 0.0
                polygon.points.append(point)

        return polygon if len(polygon.points) >= 3 else None

    def _publish_status(self, status):
        """Publish navigation status."""
        msg = String()
        msg.data = status
        self.status_pub.publish(msg)

    def _publish_dialogue(self, event_type, message):
        """Publish dialogue event for frontend."""
        event = DialogueEvent()
        event.event_type = event_type
        event.message = message
        event.timestamp = self.get_clock().now().to_msg()
        self.dialogue_pub.publish(event)


def main(args=None):
    rclpy.init(args=args)
    node = NavigationExecutorNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
