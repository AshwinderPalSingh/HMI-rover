"""
HMI Server Node — serves the built web HMI (semantic_nav_hmi/dist) over HTTP.

Lets the robot host its own operator console: no Node.js toolchain is needed at
runtime, just `npm run build` once. Also serves /hmi-config.json so the browser
learns the rosbridge port configured in the launch file.

Parameters:
  web_root       Directory with index.html (default: auto-detect <ws>/src/semantic_nav_hmi/dist)
  port           HTTP port (default 8080)
  address        Bind address (default 0.0.0.0 — reachable from the LAN)
  rosbridge_port Port advertised to the HMI in /hmi-config.json (default 9090)
"""

import json
import os
import socket
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import rclpy
from rclpy.node import Node


def find_default_web_root():
    """Locate <ws>/src/semantic_nav_hmi/dist from the installed package location."""
    env = os.environ.get('SEMANTIC_NAV_HMI_ROOT')
    if env:
        return env
    try:
        from ament_index_python.packages import get_package_share_directory
        share = get_package_share_directory('semantic_nav_bringup')
        # <ws>/install/semantic_nav_bringup/share/semantic_nav_bringup -> <ws>
        ws = os.path.abspath(os.path.join(share, '..', '..', '..', '..'))
        return os.path.join(ws, 'src', 'semantic_nav_hmi', 'dist')
    except Exception:
        return ''


class HmiRequestHandler(SimpleHTTPRequestHandler):
    """Static files + SPA fallback + runtime config, with sensible cache headers."""

    def __init__(self, *args, config_json=b'{}', logger=None, **kwargs):
        self._config_json = config_json
        self._ros_logger = logger
        super().__init__(*args, **kwargs)

    def do_GET(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        if path == '/hmi-config.json':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(self._config_json)))
            self.end_headers()
            self.wfile.write(self._config_json)
            return
        # SPA fallback: extension-less paths that don't exist resolve to index.html
        local = self.translate_path(path)
        if not os.path.exists(local) and '.' not in os.path.basename(path):
            self.path = '/index.html'
        super().do_GET()

    def end_headers(self):
        path = self.path.split('?', 1)[0]
        if path.startswith('/assets/'):
            # Vite emits content-hashed file names under /assets
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        else:
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep the launch console quiet; only report errors
        pass

    def log_error(self, fmt, *args):
        if self._ros_logger:
            self._ros_logger.warn('HTTP ' + (fmt % args))


class HmiServerNode(Node):
    """ROS 2 node wrapping a small threaded static HTTP server."""

    def __init__(self):
        super().__init__('hmi_server')

        self.declare_parameter('web_root', '')
        self.declare_parameter('port', 8080)
        self.declare_parameter('address', '0.0.0.0')
        self.declare_parameter('rosbridge_port', 9090)

        web_root = self.get_parameter('web_root').value or find_default_web_root()
        port = int(self.get_parameter('port').value)
        address = self.get_parameter('address').value
        rosbridge_port = int(self.get_parameter('rosbridge_port').value)

        web_root = os.path.abspath(os.path.expanduser(web_root)) if web_root else ''
        if not web_root or not os.path.isfile(os.path.join(web_root, 'index.html')):
            self.get_logger().error(
                f'HMI build not found at "{web_root}". Build it first:\n'
                '    cd ~/dev_ws/src/semantic_nav_hmi && npm install && npm run build\n'
                'or pass web_root:=/path/to/dist'
            )
            self.httpd = None
            return

        config_json = json.dumps({'rosbridgePort': rosbridge_port}).encode()
        handler = partial(
            HmiRequestHandler,
            directory=web_root,
            config_json=config_json,
            logger=self.get_logger(),
        )
        ThreadingHTTPServer.allow_reuse_address = True
        self.httpd = ThreadingHTTPServer((address, port), handler)
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

        host = socket.gethostname()
        self.get_logger().info(
            f'Operator console: http://localhost:{port}  (LAN: http://{host}:{port})  '
            f'serving {web_root}'
        )

    def destroy_node(self):
        if getattr(self, 'httpd', None):
            self.httpd.shutdown()
            self.httpd.server_close()
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = HmiServerNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
