"""Publish a 640x360 JPEG test pattern: red TL, green TR, blue BL, white BR, 'TOP' banner."""
import time, cv2, numpy as np, rclpy
from rclpy.node import Node
from sensor_msgs.msg import CompressedImage
rclpy.init(); n = Node('e2e_test_pattern')
pub = n.create_publisher(CompressedImage, '/e2e_cam/compressed', 1)
img = np.zeros((360, 640, 3), np.uint8)               # BGR
img[:180, :320] = (0, 0, 255); img[:180, 320:] = (0, 255, 0)
img[180:, :320] = (255, 0, 0); img[180:, 320:] = (255, 255, 255)
cv2.putText(img, 'TOP', (270, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 3)
ok, jpg = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 90])
msg = CompressedImage(); msg.format = 'jpeg'; msg.data = jpg.tobytes()
end = time.time() + 3600
while rclpy.ok() and time.time() < end:
    msg.header.stamp = n.get_clock().now().to_msg(); pub.publish(msg)
    rclpy.spin_once(n, timeout_sec=0.2)
