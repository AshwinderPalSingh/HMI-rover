# The orbit camera's current view, published (latched) whenever it changes.

std_msgs/Header header          # stamp: simulation time the view took effect — compare with the
                                # camera image stamps to know which view each frame shows
ViewerCamera view
float64 horizontal_fov          # rad, of the camera producing the picture
float64 target_radius           # m: horizontal radius and height of the followed model, so the
float64 target_height           # console can treat it as standing up when it predicts the picture
