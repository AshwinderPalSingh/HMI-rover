"""Raw global costmap costs (0-255; 254 lethal, 253 inscribed) at world points, via GetCostmap."""
import sys, time, rclpy
from rclpy.node import Node
from nav2_msgs.srv import GetCostmap
pts = list(zip(map(float, sys.argv[1::2]), map(float, sys.argv[2::2])))
rclpy.init(); n = Node('costmap_probe')
cli = n.create_client(GetCostmap, '/global_costmap/get_costmap')
if not cli.wait_for_service(timeout_sec=5): print('no service'); sys.exit(1)
fut = cli.call_async(GetCostmap.Request())
rclpy.spin_until_future_complete(n, fut, timeout_sec=10)
m = fut.result().map
md = m.metadata
out = []
for x, y in pts:
    c = int((x - md.origin.position.x) / md.resolution); r = int((y - md.origin.position.y) / md.resolution)
    out.append(str(m.data[r * md.size_x + c]) if 0 <= c < md.size_x and 0 <= r < md.size_y else 'out')
print(' '.join(out))
