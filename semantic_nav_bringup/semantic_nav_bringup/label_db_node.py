"""
Label Database Node — SQLite-backed label storage with ROS 2 service interface.

Stores labeled locations with:
  - display_name, aliases, semantic_type
  - geometry (point_radius or polygon)
  - map_version for staleness detection

Services: /add_label, /remove_label, /get_labels, /update_label
Publishes:
  /label_list (LabelArray, latched) — full snapshot on every change, including deletions
  /labels     (LabelEntry, latched) — legacy per-entry stream, kept for compatibility
"""

import os
import uuid
import sqlite3
import json
from datetime import datetime

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, QoSDurabilityPolicy

from semantic_nav_interfaces.msg import LabelArray, LabelEntry, LabelGeometry
from semantic_nav_interfaces.srv import AddLabel, RemoveLabel, GetLabels, UpdateLabel
from builtin_interfaces.msg import Time as ROSTime
from geometry_msgs.msg import Point


class LabelDbNode(Node):
    """ROS 2 node that manages the semantic label database."""

    def __init__(self):
        super().__init__('label_db_node')

        # Parameters
        self.declare_parameter('db_path', os.path.expanduser('~/.semantic_nav/labels.db'))
        self.declare_parameter('current_map_version', '')

        # Expand '~' explicitly: values coming from YAML are not expanded, and an
        # unexpanded path silently creates the database relative to the launch CWD.
        self.db_path = os.path.expanduser(
            self.get_parameter('db_path').get_parameter_value().string_value
        )
        self.current_map_version = (
            self.get_parameter('current_map_version').get_parameter_value().string_value
        )

        # Ensure directory exists
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

        # Initialize database
        self._init_db()

        # Create services
        self.add_label_srv = self.create_service(AddLabel, '/add_label', self._add_label_cb)
        self.remove_label_srv = self.create_service(
            RemoveLabel, '/remove_label', self._remove_label_cb
        )
        self.get_labels_srv = self.create_service(GetLabels, '/get_labels', self._get_labels_cb)
        self.update_label_srv = self.create_service(
            UpdateLabel, '/update_label', self._update_label_cb
        )

        # Publisher for frontend (transient local = latched)
        latched_qos = QoSProfile(depth=1, durability=QoSDurabilityPolicy.TRANSIENT_LOCAL)
        self.labels_pub = self.create_publisher(LabelEntry, '/labels', latched_qos)
        self.label_list_pub = self.create_publisher(LabelArray, '/label_list', latched_qos)

        # Publish all existing labels on startup
        self._publish_all_labels()

        self.get_logger().info(
            f'Label DB node ready. Database: {self.db_path} '
            f'({self._count_labels()} labels loaded)'
        )

    def _init_db(self):
        """Initialize SQLite database with schema."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS labels (
                label_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                aliases TEXT DEFAULT '[]',
                semantic_type TEXT DEFAULT 'other',
                geometry_type TEXT DEFAULT 'point_radius',
                geometry_x REAL DEFAULT 0.0,
                geometry_y REAL DEFAULT 0.0,
                geometry_radius REAL DEFAULT 1.0,
                geometry_polygon TEXT DEFAULT '[]',
                map_version TEXT DEFAULT '',
                created_at TEXT DEFAULT ''
            )
        ''')
        conn.commit()
        conn.close()

    def _count_labels(self):
        """Count total labels in database."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM labels')
        count = cursor.fetchone()[0]
        conn.close()
        return count

    def _add_label_cb(self, request, response):
        """Handle AddLabel service request."""
        label_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Serialize polygon points if present
            polygon_json = json.dumps([
                {'x': p.x, 'y': p.y, 'z': p.z}
                for p in request.geometry.polygon_points
            ]) if request.geometry.polygon_points else '[]'

            cursor.execute('''
                INSERT INTO labels (
                    label_id, display_name, aliases, semantic_type,
                    geometry_type, geometry_x, geometry_y, geometry_radius,
                    geometry_polygon, map_version, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                label_id,
                request.display_name,
                json.dumps(list(request.aliases)),
                request.semantic_type,
                request.geometry.type,
                request.geometry.x,
                request.geometry.y,
                request.geometry.radius,
                polygon_json,
                request.map_version or self.current_map_version,
                now,
            ))
            conn.commit()
            conn.close()

            response.label_id = label_id
            response.success = True
            response.message = f'Label "{request.display_name}" created'

            self._publish_all_labels()
            self.get_logger().info(
                f'Added label: "{request.display_name}" '
                f'at ({request.geometry.x:.2f}, {request.geometry.y:.2f})'
            )

        except Exception as e:
            response.success = False
            response.message = str(e)
            self.get_logger().error(f'Failed to add label: {e}')

        return response

    def _remove_label_cb(self, request, response):
        """Handle RemoveLabel service request."""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute('DELETE FROM labels WHERE label_id = ?', (request.label_id,))
            deleted = cursor.rowcount
            conn.commit()
            conn.close()

            if deleted > 0:
                response.success = True
                response.message = 'Label removed'
                self._publish_all_labels()
            else:
                response.success = False
                response.message = f'Label not found: {request.label_id}'

        except Exception as e:
            response.success = False
            response.message = str(e)

        return response

    def _get_labels_cb(self, request, response):
        """Handle GetLabels service request."""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            query = 'SELECT * FROM labels WHERE 1=1'
            params = []

            if request.map_version:
                query += ' AND map_version = ?'
                params.append(request.map_version)

            if request.semantic_type:
                query += ' AND semantic_type = ?'
                params.append(request.semantic_type)

            cursor.execute(query, params)
            rows = cursor.fetchall()
            conn.close()

            response.labels = [self._row_to_msg(row) for row in rows]
            response.success = True
            response.message = f'Found {len(rows)} labels'

        except Exception as e:
            response.success = False
            response.message = str(e)
            response.labels = []

        return response

    def _update_label_cb(self, request, response):
        """Handle UpdateLabel service request."""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            polygon_json = json.dumps([
                {'x': p.x, 'y': p.y, 'z': p.z}
                for p in request.geometry.polygon_points
            ]) if request.geometry.polygon_points else '[]'

            cursor.execute('''
                UPDATE labels SET
                    display_name = ?, aliases = ?, semantic_type = ?,
                    geometry_type = ?, geometry_x = ?, geometry_y = ?,
                    geometry_radius = ?, geometry_polygon = ?
                WHERE label_id = ?
            ''', (
                request.display_name,
                json.dumps(list(request.aliases)),
                request.semantic_type,
                request.geometry.type,
                request.geometry.x,
                request.geometry.y,
                request.geometry.radius,
                polygon_json,
                request.label_id,
            ))

            updated = cursor.rowcount
            conn.commit()
            conn.close()

            if updated > 0:
                response.success = True
                response.message = 'Label updated'
                self._publish_all_labels()
            else:
                response.success = False
                response.message = f'Label not found: {request.label_id}'

        except Exception as e:
            response.success = False
            response.message = str(e)

        return response

    def _publish_all_labels(self):
        """Publish the label snapshot (and the legacy per-entry stream)."""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM labels')
            rows = cursor.fetchall()
            conn.close()

            entries = [self._row_to_msg(row) for row in rows]

            snapshot = LabelArray()
            snapshot.header.stamp = self.get_clock().now().to_msg()
            snapshot.header.frame_id = 'map'
            snapshot.labels = entries
            self.label_list_pub.publish(snapshot)

            for msg in entries:
                self.labels_pub.publish(msg)

        except Exception as e:
            self.get_logger().error(f'Failed to publish labels: {e}')

    def _row_to_msg(self, row):
        """Convert a database row to a LabelEntry message."""
        msg = LabelEntry()
        msg.label_id = row[0]
        msg.display_name = row[1]
        msg.aliases = json.loads(row[2]) if row[2] else []
        msg.semantic_type = row[3] or 'other'

        msg.geometry = LabelGeometry()
        msg.geometry.type = row[4] or 'point_radius'
        msg.geometry.x = float(row[5] or 0.0)
        msg.geometry.y = float(row[6] or 0.0)
        msg.geometry.radius = float(row[7] or 1.0)

        # Parse polygon points
        polygon_data = json.loads(row[8]) if row[8] else []
        msg.geometry.polygon_points = []
        for p in polygon_data:
            point = Point()
            point.x = float(p.get('x', 0))
            point.y = float(p.get('y', 0))
            point.z = float(p.get('z', 0))
            msg.geometry.polygon_points.append(point)

        msg.map_version = row[9] or ''

        # Parse timestamp
        if row[10]:
            try:
                dt = datetime.fromisoformat(row[10])
                msg.created_at = ROSTime()
                msg.created_at.sec = int(dt.timestamp())
            except (ValueError, OSError):
                pass

        return msg


def main(args=None):
    rclpy.init(args=args)
    node = LabelDbNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
