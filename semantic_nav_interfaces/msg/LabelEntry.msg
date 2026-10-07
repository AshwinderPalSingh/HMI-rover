# Full label record stored in the label database

string label_id                      # UUID
string display_name                  # Human-readable name ("Ash's house")
string[] aliases                     # Alternative names ("the house", "my house", "home")
string semantic_type                 # Category ("house", "park", "road")
LabelGeometry geometry               # Spatial extent
string map_version                   # Map version this label was created on
builtin_interfaces/Time created_at   # Creation timestamp
