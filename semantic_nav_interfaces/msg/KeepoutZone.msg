# Runtime keepout zone representation

string zone_id                       # Unique zone identifier
string zone_group_id                 # Group ID for batch operations (e.g., "all houses")
string reason                        # Human-readable reason ("avoid playground")
geometry_msgs/Polygon polygon        # Zone boundary
string duration                      # "session", "permanent", "one_shot"
float64 ttl_seconds                  # Time-to-live for one_shot zones (0 = no expiry)
bool is_active                       # Whether zone is currently enforced
