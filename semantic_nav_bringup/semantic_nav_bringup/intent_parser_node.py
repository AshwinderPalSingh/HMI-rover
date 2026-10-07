"""
Intent Parser Node — LLM-based natural language understanding.

Receives raw voice/text commands, sends them to the Gemini API (google-genai SDK),
produces structured JSON intent: {action, target, category, duration}

The LLM's ONLY job is linguistic parsing — it never resolves locations.
Without an API key (or if the call fails) a rule-based parser is used.

API key: set GEMINI_API_KEY (or GOOGLE_API_KEY) in the environment that runs the
launch file — keep it out of version control. The gemini_api_key parameter is
still honoured as a fallback.
"""

import json
import os

import rclpy
from rclpy.node import Node

from std_msgs.msg import String
from semantic_nav_interfaces.msg import NavigationIntent


# System prompt constraining the LLM to structured output only
SYSTEM_PROMPT = """You are a robot command parser. Your ONLY job is to convert natural language 
commands into structured JSON. You do NOT know where anything is located. You do NOT make 
navigation decisions.

Output EXACTLY ONE JSON object per command. Valid actions:
- "navigate_to" — go to a place (e.g., "go to the house", "take me to the park")
- "avoid_zone" — avoid a place (e.g., "avoid the playground", "stay away from the road")
- "clear_zone" — stop avoiding a place (e.g., "it's okay to go near the park now")
- "cancel" — cancel current navigation (e.g., "stop", "cancel", "nevermind")

Fields:
- action: string (one of above)
- target: string (the place name from the user's words, NOT resolved)
- is_category: boolean (true if user said "all X" or "every X", e.g., "avoid all houses")
- duration: string ("session" default, "permanent" if user says "always", "one_shot" if temporary)

Examples:
User: "go to Ash's house" → {"action": "navigate_to", "target": "Ash's house", "is_category": false, "duration": "session"}
User: "avoid the playground" → {"action": "avoid_zone", "target": "playground", "is_category": false, "duration": "session"}
User: "avoid all houses" → {"action": "avoid_zone", "target": "houses", "is_category": true, "duration": "session"}
User: "always stay away from the road" → {"action": "avoid_zone", "target": "road", "is_category": false, "duration": "permanent"}
User: "stop" → {"action": "cancel", "target": "", "is_category": false, "duration": "session"}
User: "it's fine to go near the park now" → {"action": "clear_zone", "target": "park", "is_category": false, "duration": "session"}

Respond with ONLY the JSON object. No explanations, no markdown, no extra text."""


class IntentParserNode(Node):
    """Parses natural language commands into structured intents using Gemini."""

    def __init__(self):
        super().__init__('intent_parser_node')

        # Parameters
        self.declare_parameter('gemini_api_key', '')
        self.declare_parameter('model_name', 'gemini-3.5-flash-lite')
        self.declare_parameter('request_timeout', 15.0)  # seconds; the Gemini API rejects < 10 s

        # Same precedence as the Gemini SDK: GOOGLE_API_KEY, then GEMINI_API_KEY
        self.api_key = (
            os.environ.get('GOOGLE_API_KEY')
            or os.environ.get('GEMINI_API_KEY')
            or self.get_parameter('gemini_api_key').get_parameter_value().string_value
        )
        self.model_name = self.get_parameter('model_name').get_parameter_value().string_value
        timeout_s = self.get_parameter('request_timeout').get_parameter_value().double_value
        self.client = self._make_client(self.api_key, timeout_s) if self.api_key else None

        # Subscribers
        self.command_sub = self.create_subscription(
            String, '/voice_command', self._command_cb, 10
        )

        # Publishers
        self.intent_pub = self.create_publisher(NavigationIntent, '/navigation_intent', 10)

        if self.client:
            self.get_logger().info(f'Intent Parser ready (LLM: {self.model_name})')
        else:
            self.get_logger().info(
                'Intent Parser ready (rule-based). For LLM parsing set GEMINI_API_KEY '
                'and pip install google-genai.'
            )

    def _make_client(self, api_key, timeout_s):
        """Create the Gemini client once; None (rule-based parsing) if unavailable."""
        try:
            from google import genai
            from google.genai import types
        except ImportError:
            self.get_logger().error(
                'GEMINI_API_KEY is set but google-genai is not installed: '
                'pip install google-genai. Using rule-based parsing.'
            )
            return None
        try:
            return genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(timeout=int(max(timeout_s, 10.0) * 1000)),
            )
        except Exception as e:
            self.get_logger().error(f'Could not create the Gemini client ({e}); using rule-based parsing.')
            return None

    def _command_cb(self, msg):
        """Handle incoming voice/text command."""
        command_text = msg.data.strip()
        if not command_text:
            return

        self.get_logger().info(f'Parsing command: "{command_text}"')

        if self.client:
            intent = self._parse_with_llm(command_text)
        else:
            intent = self._parse_with_rules(command_text)

        if intent:
            intent_msg = NavigationIntent()
            intent_msg.action = intent.get('action', '')
            intent_msg.target = intent.get('target', '')
            intent_msg.is_category = intent.get('is_category', False)
            intent_msg.duration = intent.get('duration', 'session')
            intent_msg.raw_command = command_text

            self.intent_pub.publish(intent_msg)
            self.get_logger().info(f'Published intent: {intent}')
        else:
            self.get_logger().warn(f'Failed to parse command: "{command_text}"')

    VALID_ACTIONS = ('navigate_to', 'avoid_zone', 'clear_zone', 'cancel')
    VALID_DURATIONS = ('session', 'permanent', 'one_shot')

    def _parse_with_llm(self, command_text):
        """Parse with Gemini; any failure falls back to the rule-based parser."""
        from google.genai import types
        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=command_text,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.1,
                    max_output_tokens=256,
                    response_mime_type='application/json',
                    # plain parsing, no tools: keep the SDK from probing function calling
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                ),
            )
            text = (response.text or '').strip()
            # Tolerate a markdown fence even though JSON output was requested
            if text.startswith('```'):
                text = text.split('\n', 1)[1].rsplit('```', 1)[0].strip()
            intent = self._validate(json.loads(text))
            if intent is None:
                raise ValueError(f'unexpected LLM output: {text[:120]}')
            return intent
        except Exception as e:
            self.get_logger().error(f'LLM parsing failed ({e}); using rule-based parsing')
            return self._parse_with_rules(command_text)

    def _validate(self, data):
        """Normalise an LLM intent; None if it doesn't fit the schema."""
        if not isinstance(data, dict):
            return None
        action = str(data.get('action', '')).strip()
        if action not in self.VALID_ACTIONS:
            return None
        duration = str(data.get('duration') or 'session').strip()
        return {
            'action': action,
            'target': '' if action == 'cancel' else self._clean_target(str(data.get('target', '')).lower()),
            'is_category': bool(data.get('is_category', False)),
            'duration': duration if duration in self.VALID_DURATIONS else 'session',
        }

    @staticmethod
    def _clean_target(target):
        """Strip punctuation and leading quantifiers/articles, like the LLM prompt examples do."""
        t = target.strip(' .,!?')
        changed = True
        while changed:
            changed = False
            for prefix in ('all ', 'every ', 'each ', 'the ', 'a ', 'an '):
                if t.startswith(prefix):
                    t = t[len(prefix):].strip()
                    changed = True
        return t

    def _parse_with_rules(self, command_text):
        """Simple rule-based fallback parser."""
        text = command_text.lower().strip()

        # Cancel commands
        if text in ('stop', 'cancel', 'nevermind', 'abort', 'halt'):
            return {
                'action': 'cancel',
                'target': '',
                'is_category': False,
                'duration': 'session',
            }

        # Detect category
        is_category = any(w in text for w in ['all ', 'every ', 'each '])

        # Detect duration
        duration = 'session'
        if any(w in text for w in ['always', 'permanently', 'forever']):
            duration = 'permanent'
        elif any(w in text for w in ['temporarily', 'for now', 'briefly']):
            duration = 'one_shot'

        # Navigate commands
        nav_patterns = ['go to ', 'navigate to ', 'take me to ', 'drive to ', 'head to ']
        for pattern in nav_patterns:
            if pattern in text:
                target = self._clean_target(text.split(pattern, 1)[1])
                return {
                    'action': 'navigate_to',
                    'target': target,
                    'is_category': is_category,
                    'duration': duration,
                }

        # Avoid commands
        avoid_patterns = [
            'avoid ', 'stay away from ', 'don\'t go near ', 'keep away from ',
            'do not go to ', 'steer clear of '
        ]
        for pattern in avoid_patterns:
            if pattern in text:
                target = self._clean_target(text.split(pattern, 1)[1])
                return {
                    'action': 'avoid_zone',
                    'target': target,
                    'is_category': is_category,
                    'duration': duration,
                }

        # Clear zone commands
        clear_patterns = [
            'it\'s okay to go near ', 'clear zone ', 'remove zone ',
            'allow ', 'unblock ', 'it\'s fine to go to '
        ]
        for pattern in clear_patterns:
            if pattern in text:
                target = self._clean_target(text.split(pattern, 1)[1])
                return {
                    'action': 'clear_zone',
                    'target': target,
                    'is_category': is_category,
                    'duration': duration,
                }

        # Default: assume navigation
        # Strip common prefixes
        target = text
        for prefix in ['go ', 'the ', 'to ']:
            if target.startswith(prefix):
                target = target[len(prefix):]

        return {
            'action': 'navigate_to',
            'target': target,
            'is_category': is_category,
            'duration': duration,
        }


def main(args=None):
    rclpy.init(args=args)
    node = IntentParserNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
