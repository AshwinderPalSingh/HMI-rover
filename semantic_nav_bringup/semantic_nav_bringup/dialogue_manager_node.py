"""
Dialogue Manager Node — Disambiguation, timeout/fallback, preemption policy.

Receives resolved (or ambiguous) intents, manages conversation state,
asks follow-up questions, enforces timeout, and routes final commands
to the navigation executor.

Preemption Policy:
  - navigate_to while navigating → REJECT ("still navigating, say cancel first")
  - avoid_zone while navigating  → ALLOW (costmap-only, triggers replan)
  - cancel                       → Cancel current Nav2 goal
"""

import uuid
from threading import Timer

import rclpy
from rclpy.node import Node

from std_msgs.msg import String
from semantic_nav_interfaces.msg import NavigationIntent, DialogueEvent
from semantic_nav_interfaces.srv import ResolveTarget


class DialogueManagerNode(Node):
    """Manages disambiguation dialogue and command routing."""

    def __init__(self):
        super().__init__('dialogue_manager_node')

        # Parameters
        self.declare_parameter('disambiguation_timeout', 15.0)  # seconds
        self.declare_parameter('max_reprompts', 1)

        self.timeout_sec = (
            self.get_parameter('disambiguation_timeout')
            .get_parameter_value().double_value
        )
        self.max_reprompts = (
            self.get_parameter('max_reprompts')
            .get_parameter_value().integer_value
        )

        # State
        self.is_navigating = False
        self.pending_intent = None
        self.pending_options = []
        self.pending_intent_id = None
        self.reprompt_count = 0
        self.timeout_timer = None

        # Subscribers
        self.intent_sub = self.create_subscription(
            NavigationIntent, '/resolved_intent', self._intent_cb, 10
        )
        self.response_sub = self.create_subscription(
            String, '/dialogue_response', self._response_cb, 10
        )
        self.nav_status_sub = self.create_subscription(
            String, '/nav_execution_status', self._nav_status_cb, 10
        )

        # Publishers
        self.command_pub = self.create_publisher(NavigationIntent, '/execute_command', 10)
        self.dialogue_pub = self.create_publisher(DialogueEvent, '/dialogue_events', 10)
        self.question_pub = self.create_publisher(String, '/dialogue_question', 10)

        # Resolve service client
        self.resolve_client = self.create_client(ResolveTarget, '/resolve_target')

        self.get_logger().info('Dialogue Manager ready')

    def _intent_cb(self, msg):
        """Handle incoming (possibly ambiguous) intent."""
        intent_id = str(uuid.uuid4())[:8]

        self.get_logger().info(
            f'[{intent_id}] Received intent: action={msg.action} '
            f'target="{msg.target}" category={msg.is_category}'
        )

        # ── Preemption policy ──
        if msg.action == 'cancel':
            self._publish_event('executing', 'Cancelling navigation...', intent_id)
            cancel_msg = NavigationIntent()
            cancel_msg.action = 'cancel'
            self.command_pub.publish(cancel_msg)
            self.is_navigating = False
            return

        if msg.action == 'navigate_to' and self.is_navigating:
            # REJECT — don't silently preempt
            reject_msg = "I'm still navigating. Say 'cancel' first."
            self._publish_event('rejected', reject_msg, intent_id)
            self.get_logger().info(f'[{intent_id}] Rejected: navigating')
            return

        if msg.action == 'avoid_zone' and self.is_navigating:
            # ALLOW — costmap-only, current plan will replan
            self.get_logger().info(
                f'[{intent_id}] Allowing avoid_zone during navigation'
            )

        # ── Resolve target ──
        if not msg.target:
            if msg.action != 'cancel':
                self._publish_event(
                    'failed', "I didn't understand what place you mean.", intent_id
                )
            return

        # Call resolve service
        if self.resolve_client.wait_for_service(timeout_sec=2.0):
            request = ResolveTarget.Request()
            request.target_text = msg.target
            request.is_category = msg.is_category

            future = self.resolve_client.call_async(request)
            future.add_done_callback(
                lambda f: self._on_resolve_result(f, msg, intent_id)
            )
        else:
            # Service not available — try to proceed with target as-is
            self.get_logger().warn('ResolveTarget service not available — using raw target')
            self._execute_intent(msg, intent_id)

    def _on_resolve_result(self, future, original_intent, intent_id):
        """Handle resolution result."""
        try:
            result = future.result()
        except Exception as e:
            self.get_logger().error(f'Resolve service call failed: {e}')
            self._publish_event('failed', f'Resolution error: {e}', intent_id)
            return

        if not result.matches:
            self._publish_event(
                'failed',
                f'I don\'t know where "{original_intent.target}" is. '
                f'Have you labeled it on the map?',
                intent_id,
            )
            return

        if result.is_ambiguous and len(result.matches) > 1:
            # ── Disambiguation needed ──
            options = [m.display_name for m in result.matches[:5]]
            question = f'Which one do you mean — {", ".join(options)}?'

            self.pending_intent = original_intent
            self.pending_options = result.matches[:5]
            self.pending_intent_id = intent_id
            self.reprompt_count = 0

            self._publish_event('question', question, intent_id, options)

            # Publish for TTS
            q_msg = String()
            q_msg.data = question
            self.question_pub.publish(q_msg)

            # Start timeout timer
            self._start_timeout()

            self.get_logger().info(f'[{intent_id}] Asking disambiguation: {options}')
        else:
            # ── Unambiguous — execute immediately ──
            resolved_intent = NavigationIntent()
            resolved_intent.action = original_intent.action
            # A category ("all houses") must stay a category: the executor looks
            # labels up by type and derives the zone group id from it
            resolved_intent.target = (
                original_intent.target if original_intent.is_category
                else result.matches[0].display_name
            )
            resolved_intent.is_category = original_intent.is_category
            resolved_intent.duration = original_intent.duration
            resolved_intent.raw_command = original_intent.raw_command

            self._execute_intent(resolved_intent, intent_id)

    def _response_cb(self, msg):
        """Handle user's response to disambiguation question."""
        if not self.pending_intent:
            return

        response_text = msg.data.strip().lower()
        self._cancel_timeout()

        # Find matching option
        matched = None
        for option in self.pending_options:
            if response_text in option.display_name.lower():
                matched = option
                break

        if not matched and self.pending_options:
            # Try exact match on display name
            for option in self.pending_options:
                if option.display_name.lower() == response_text:
                    matched = option
                    break

        if matched:
            # ── Resolved! ──
            resolved_intent = NavigationIntent()
            resolved_intent.action = self.pending_intent.action
            resolved_intent.target = matched.display_name
            resolved_intent.is_category = self.pending_intent.is_category
            resolved_intent.duration = self.pending_intent.duration
            resolved_intent.raw_command = self.pending_intent.raw_command

            self._publish_event(
                'resolved',
                f'Got it — {matched.display_name}.',
                self.pending_intent_id,
            )
            self._execute_intent(resolved_intent, self.pending_intent_id)
            self._clear_pending()
        else:
            # ── Unrecognized response — reprompt or cancel ──
            self.reprompt_count += 1
            if self.reprompt_count > self.max_reprompts:
                self._publish_event(
                    'cancelled',
                    "I couldn't understand your response. Command cancelled.",
                    self.pending_intent_id,
                )
                self._clear_pending()
            else:
                options = [o.display_name for o in self.pending_options]
                question = f"Sorry, I didn't catch that. Which one — {', '.join(options)}?"
                self._publish_event(
                    'question', question, self.pending_intent_id, options
                )
                self._start_timeout()

    def _execute_intent(self, intent, intent_id):
        """Forward a fully resolved intent to the navigation executor."""
        self._publish_event(
            'executing',
            f'{intent.action.replace("_", " ").title()}: {intent.target}',
            intent_id,
        )
        self.command_pub.publish(intent)

        if intent.action == 'navigate_to':
            self.is_navigating = True

        self.get_logger().info(
            f'[{intent_id}] Executing: {intent.action} → "{intent.target}"'
        )

    def _nav_status_cb(self, msg):
        """Handle navigation status updates."""
        status = msg.data
        if status in ('completed', 'failed', 'cancelled'):
            self.is_navigating = False

    def _start_timeout(self):
        """Start the disambiguation timeout timer."""
        self._cancel_timeout()
        self.timeout_timer = Timer(self.timeout_sec, self._on_timeout)
        self.timeout_timer.start()

    def _cancel_timeout(self):
        """Cancel the timeout timer."""
        if self.timeout_timer:
            self.timeout_timer.cancel()
            self.timeout_timer = None

    def _on_timeout(self):
        """Handle disambiguation timeout — cancel the command."""
        if self.pending_intent:
            self.get_logger().info(
                f'[{self.pending_intent_id}] Disambiguation timed out'
            )
            self._publish_event(
                'timeout',
                'No response received. Command cancelled.',
                self.pending_intent_id,
            )
            self._clear_pending()

    def _clear_pending(self):
        """Clear pending disambiguation state."""
        self.pending_intent = None
        self.pending_options = []
        self.pending_intent_id = None
        self.reprompt_count = 0
        self._cancel_timeout()

    def _publish_event(self, event_type, message, intent_id, options=None):
        """Publish a dialogue event for frontend visualization."""
        event = DialogueEvent()
        event.event_type = event_type
        event.message = message
        event.options = options or []
        event.intent_id = intent_id
        event.timestamp = self.get_clock().now().to_msg()
        self.dialogue_pub.publish(event)


def main(args=None):
    rclpy.init(args=args)
    node = DialogueManagerNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
