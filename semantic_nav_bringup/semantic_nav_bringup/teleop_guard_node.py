"""
Teleop Guard Node — deadman watchdog between the web HMI and the robot base.

The HMI publishes velocity on /hmi/cmd_vel only while the operator is actively
driving. This node forwards those commands to /cmd_vel (clamped to safe limits)
and, if the stream stops unexpectedly (browser crash, closed laptop, Wi-Fi drop),
publishes a zero Twist after `timeout` seconds so the robot does not keep
executing the last command. The Gazebo diff-drive plugin has no command timeout
of its own, so without this a dropped connection mid-drive leaves the robot moving.

When idle the node publishes nothing, so Nav2 keeps ownership of /cmd_vel.
Timing uses the monotonic wall clock on purpose: the browser stream is wall-time,
independent of use_sim_time.
"""

import math
import time

import rclpy
from rclpy.node import Node

from geometry_msgs.msg import Twist


class TeleopGuardNode(Node):
    """Forwards HMI teleop commands and stops the robot if the stream goes stale."""

    def __init__(self):
        super().__init__('teleop_guard')

        self.declare_parameter('input_topic', '/hmi/cmd_vel')
        self.declare_parameter('output_topic', '/cmd_vel')
        self.declare_parameter('timeout', 0.5)        # seconds without input before stopping
        self.declare_parameter('max_linear', 0.5)     # m/s clamp
        self.declare_parameter('max_angular', 1.5)    # rad/s clamp
        self.declare_parameter('check_rate', 20.0)    # Hz

        input_topic = self.get_parameter('input_topic').value
        output_topic = self.get_parameter('output_topic').value
        self.timeout = float(self.get_parameter('timeout').value)
        self.max_linear = abs(float(self.get_parameter('max_linear').value))
        self.max_angular = abs(float(self.get_parameter('max_angular').value))
        check_rate = float(self.get_parameter('check_rate').value)

        self.active = False
        self.last_input = 0.0

        self.pub = self.create_publisher(Twist, output_topic, 10)
        self.sub = self.create_subscription(Twist, input_topic, self._input_cb, 10)
        self.timer = self.create_timer(1.0 / check_rate, self._check)

        self.get_logger().info(
            f'Teleop guard: {input_topic} -> {output_topic} '
            f'(timeout {self.timeout:.2f}s, limits {self.max_linear} m/s, {self.max_angular} rad/s)'
        )

    @staticmethod
    def _clamp(value, limit):
        if not math.isfinite(value):
            return 0.0
        return max(-limit, min(limit, value))

    def _input_cb(self, msg):
        out = Twist()
        out.linear.x = self._clamp(msg.linear.x, self.max_linear)
        out.linear.y = self._clamp(msg.linear.y, self.max_linear)
        out.angular.z = self._clamp(msg.angular.z, self.max_angular)
        self.pub.publish(out)

        is_zero = out.linear.x == 0.0 and out.linear.y == 0.0 and out.angular.z == 0.0
        # An explicit zero means the operator released the controls: go idle
        # immediately and hand /cmd_vel back to autonomy.
        self.active = not is_zero
        self.last_input = time.monotonic()

    def _check(self):
        if self.active and time.monotonic() - self.last_input > self.timeout:
            self.active = False
            self.pub.publish(Twist())
            self.get_logger().warn(
                f'Teleop stream lost for >{self.timeout:.2f}s — robot stopped'
            )


def main(args=None):
    rclpy.init(args=args)
    node = TeleopGuardNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        if rclpy.ok():
            node.pub.publish(Twist())
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
