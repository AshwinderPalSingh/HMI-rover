# Geometry definition for a labeled region
# Supports both point+radius and polygon representations

string TYPE_POINT_RADIUS = point_radius
string TYPE_POLYGON = polygon

string type                          # "point_radius" or "polygon"
float64 x                           # Center x (for point_radius)
float64 y                           # Center y (for point_radius)
float64 radius                      # Radius in meters (for point_radius)
geometry_msgs/Point[] polygon_points # Polygon vertices (for polygon type)
