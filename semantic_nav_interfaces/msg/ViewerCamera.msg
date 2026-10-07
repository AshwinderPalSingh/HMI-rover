# Orbit camera for the operator console's 3D view (simulation only).
# The camera looks at a target point near the robot from a point on a sphere
# around it, like the Gazebo GUI's orbit view.

float64 azimuth                 # rad around the target; 0 = behind the robot when follow_heading
float64 elevation               # rad above the horizontal (camera looks down at the target)
float64 distance                # m from the target; in a command, <= 0 resets to the default view
geometry_msgs/Point offset      # target relative to the ground point under the robot (robot frame if
                                # follow_heading, else world axes); z is the height above the ground
bool follow_heading             # true: rotate with the robot (chase view); false: world-fixed orientation
