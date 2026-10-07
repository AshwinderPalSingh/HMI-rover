# Full snapshot of all keepout zones held by the costmap layer.
# Published latched (transient_local, depth 1) on every change (add, remove,
# expiry), including an empty list, so subscribers can mirror the exact state.

std_msgs/Header header
KeepoutZone[] zones
