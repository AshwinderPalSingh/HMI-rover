# Full snapshot of the label database.
# Published latched (transient_local, depth 1) on every change, including an
# empty list after the last label is removed, so late joiners always get the
# current state and deletions propagate.

std_msgs/Header header               # stamp = time of change, frame_id = map frame of the geometry
LabelEntry[] labels
