# Parsed LLM output — structured intent from natural language

string ACTION_NAVIGATE_TO = navigate_to
string ACTION_AVOID_ZONE = avoid_zone
string ACTION_CLEAR_ZONE = clear_zone
string ACTION_CANCEL = cancel

string DURATION_SESSION = session
string DURATION_PERMANENT = permanent
string DURATION_ONE_SHOT = one_shot

string action                        # navigate_to, avoid_zone, clear_zone, cancel
string target                        # Target name from user command
bool is_category                     # True if target is a category ("all houses")
string duration                      # session, permanent, one_shot
string raw_command                   # Original user command text
