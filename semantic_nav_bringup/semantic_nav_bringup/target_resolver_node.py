"""
Target Resolver Node — Embedding-based semantic grounding.

Compares parsed intent targets against the label database using
sentence-transformer cosine similarity. Implements the similarity
margin rule: if top1 - top2 < epsilon, flags as ambiguous.
"""

import json
import numpy as np

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, QoSDurabilityPolicy, QoSReliabilityPolicy

from semantic_nav_interfaces.msg import NavigationIntent, LabelArray
from semantic_nav_interfaces.srv import ResolveTarget, GetLabels
from semantic_nav_bringup.text_utils import category_matches


class TargetResolverNode(Node):
    """Resolves text targets to labeled locations using embedding similarity."""

    def __init__(self):
        super().__init__('target_resolver_node')

        # Parameters
        self.declare_parameter('model_name', 'all-MiniLM-L6-v2')
        self.declare_parameter('epsilon', 0.05)  # Ambiguity threshold

        self.model_name = self.get_parameter('model_name').get_parameter_value().string_value
        self.epsilon = self.get_parameter('epsilon').get_parameter_value().double_value

        # State
        self.model = None
        self.labels = []
        self.label_texts = []  # Flattened list of all name + aliases
        self.label_embeddings = None
        self.label_indices = []  # Maps embedding index → label index

        # Latched full snapshot: late joiners get the current labels and deletions propagate
        snapshot_qos = QoSProfile(
            depth=1,
            durability=QoSDurabilityPolicy.TRANSIENT_LOCAL,
            reliability=QoSReliabilityPolicy.RELIABLE,
        )
        self.labels_sub = self.create_subscription(
            LabelArray, '/label_list', self._label_list_cb, snapshot_qos
        )

        # Service
        self.resolve_srv = self.create_service(
            ResolveTarget, '/resolve_target', self._resolve_cb
        )

        # Subscribe to intents for auto-resolution
        self.intent_sub = self.create_subscription(
            NavigationIntent, '/navigation_intent', self._intent_cb, 10
        )

        # Publisher for resolved intents
        self.resolved_pub = self.create_publisher(NavigationIntent, '/resolved_intent', 10)

        # Load model
        self._load_model()

        self.get_logger().info(
            f'Target Resolver ready (model: {self.model_name}, ε={self.epsilon})'
        )

    def _load_model(self):
        """Load sentence-transformers model."""
        try:
            from sentence_transformers import SentenceTransformer
            self.model = SentenceTransformer(self.model_name)
            self.get_logger().info(f'Loaded embedding model: {self.model_name}')
        except ImportError:
            self.get_logger().error(
                'sentence-transformers not installed. '
                'Run: pip install sentence-transformers'
            )
        except Exception as e:
            self.get_logger().error(f'Failed to load model: {e}')

    def _label_list_cb(self, msg):
        """Replace the label cache with the latest snapshot and rebuild embeddings."""
        old_texts = self._texts_of(self.labels)
        self.labels = list(msg.labels)
        if self._texts_of(self.labels) != old_texts or self.label_embeddings is None:
            self._rebuild_embeddings()
        if not self.labels:
            self.label_texts = []
            self.label_indices = []
            self.label_embeddings = None
        self.get_logger().info(f'Label cache updated: {len(self.labels)} labels')

    @staticmethod
    def _texts_of(labels):
        return [(l.label_id, l.display_name, tuple(l.aliases)) for l in labels]

    def _rebuild_embeddings(self):
        """Recompute embeddings for all label names + aliases."""
        if not self.model or not self.labels:
            return

        self.label_texts = []
        self.label_indices = []

        for i, label in enumerate(self.labels):
            # Add display name
            self.label_texts.append(label.display_name.lower())
            self.label_indices.append(i)

            # Add each alias
            for alias in label.aliases:
                self.label_texts.append(alias.lower())
                self.label_indices.append(i)

        if self.label_texts:
            self.label_embeddings = self.model.encode(
                self.label_texts, convert_to_numpy=True, normalize_embeddings=True
            )
            self.get_logger().info(
                f'Rebuilt embeddings: {len(self.label_texts)} texts '
                f'from {len(self.labels)} labels'
            )

    def _resolve(self, target_text, is_category=False):
        """
        Resolve a target string to matching labels.

        Returns: (matches: list[LabelEntry], scores: list[float], is_ambiguous: bool)
        """
        if not self.labels:
            return [], [], False

        if is_category:
            # Category match on semantic_type; accepts plurals ("houses" -> "house")
            matches = [
                l for l in self.labels
                if category_matches(l.semantic_type, target_text)
            ]
            scores = [1.0] * len(matches)
            return matches, scores, False

        if not self.model or self.label_embeddings is None:
            # Fallback: exact/substring match
            return self._resolve_exact(target_text)

        # Embedding-based similarity
        query_embedding = self.model.encode(
            [target_text.lower()], convert_to_numpy=True, normalize_embeddings=True
        )

        # Cosine similarity (embeddings are normalized, so dot product = cosine)
        similarities = np.dot(self.label_embeddings, query_embedding.T).flatten()

        # Aggregate scores per label (take max alias score)
        label_scores = {}
        for idx, sim in enumerate(similarities):
            label_idx = self.label_indices[idx]
            label_id = self.labels[label_idx].label_id
            if label_id not in label_scores or sim > label_scores[label_id]:
                label_scores[label_id] = float(sim)

        if not label_scores:
            return [], [], False

        # Sort by score descending
        sorted_labels = sorted(label_scores.items(), key=lambda x: x[1], reverse=True)

        # Apply similarity margin rule
        top1_score = sorted_labels[0][1]
        top2_score = sorted_labels[1][1] if len(sorted_labels) > 1 else 0.0
        is_ambiguous = (top1_score - top2_score) < self.epsilon

        # Build result
        matches = []
        scores = []
        for label_id, score in sorted_labels:
            label = next((l for l in self.labels if l.label_id == label_id), None)
            if label:
                matches.append(label)
                scores.append(score)

        return matches, scores, is_ambiguous

    def _resolve_exact(self, target_text):
        """Fallback: exact/substring matching."""
        target_lower = target_text.lower()
        matches = []
        scores = []

        for label in self.labels:
            # Check display name
            if target_lower in label.display_name.lower():
                matches.append(label)
                scores.append(0.9)
                continue

            # Check aliases
            for alias in label.aliases:
                if target_lower in alias.lower():
                    matches.append(label)
                    scores.append(0.8)
                    break

        is_ambiguous = len(matches) > 1
        return matches, scores, is_ambiguous

    def _resolve_cb(self, request, response):
        """Handle ResolveTarget service request."""
        matches, scores, is_ambiguous = self._resolve(
            request.target_text, request.is_category
        )

        response.matches = matches
        response.scores = scores
        response.is_ambiguous = is_ambiguous
        response.success = True
        response.message = (
            f'Found {len(matches)} matches '
            f'(ambiguous: {is_ambiguous})'
        )

        self.get_logger().info(
            f'Resolved "{request.target_text}": '
            f'{len(matches)} matches, ambiguous={is_ambiguous}'
        )

        return response

    def _intent_cb(self, msg):
        """Auto-resolve incoming navigation intents."""
        if msg.action == 'cancel':
            # Pass through cancels without resolution
            self.resolved_pub.publish(msg)
            return

        matches, scores, is_ambiguous = self._resolve(msg.target, msg.is_category)

        if not matches:
            self.get_logger().warn(f'No matches for target: "{msg.target}"')
            # Still publish — dialogue manager will handle the error
            self.resolved_pub.publish(msg)
            return

        if is_ambiguous:
            self.get_logger().info(f'Ambiguous target: "{msg.target}" — needs disambiguation')
            # Dialogue manager will handle disambiguation
            self.resolved_pub.publish(msg)
        else:
            self.get_logger().info(
                f'Resolved "{msg.target}" → "{matches[0].display_name}" '
                f'(score: {scores[0]:.3f})'
            )
            # Update target with resolved label name (categories keep the category)
            resolved = NavigationIntent()
            resolved.action = msg.action
            resolved.target = msg.target if msg.is_category else matches[0].display_name
            resolved.is_category = msg.is_category
            resolved.duration = msg.duration
            resolved.raw_command = msg.raw_command
            self.resolved_pub.publish(resolved)


def main(args=None):
    rclpy.init(args=args)
    node = TargetResolverNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
