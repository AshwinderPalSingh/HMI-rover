# Dialogue state transitions for frontend visualization

string EVENT_QUESTION = question
string EVENT_TIMEOUT = timeout
string EVENT_RESOLVED = resolved
string EVENT_CANCELLED = cancelled
string EVENT_REJECTED = rejected
string EVENT_EXECUTING = executing
string EVENT_COMPLETED = completed
string EVENT_FAILED = failed

string event_type                    # Type of dialogue event
string message                       # Human-readable message (question text, status, etc.)
string[] options                     # Disambiguation options (if event_type == question)
string intent_id                     # Links event to the originating intent
builtin_interfaces/Time timestamp    # Event timestamp
