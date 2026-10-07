# Overall system status for frontend display

string MODE_TELEOP = teleop
string MODE_MAPPING = mapping
string MODE_LABELING = labeling
string MODE_COMMANDING = commanding

string NAV_IDLE = idle
string NAV_NAVIGATING = navigating
string NAV_PLANNING = planning
string NAV_RECOVERING = recovering

string mode                          # Current app mode
string nav_status                    # Navigation status
string current_goal_label            # Name of current navigation target (if any)
float64 nav_progress                 # 0.0 to 1.0 progress toward goal
bool is_mapping                      # Whether SLAM is actively mapping
int32 label_count                    # Number of labels in database
int32 active_zone_count              # Number of active keepout zones
