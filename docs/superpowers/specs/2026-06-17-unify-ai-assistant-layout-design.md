# Unified AI Assistant Layout Design

## Goal

Make the AI assistant areas in Blueprint and Files visually match the Samples AI assistant layout.

## Reference Layout

Samples uses:

- `content-grid templates-content-grid samples-content-grid` on the page wrapper;
- a focused `AssistantPanel` with `showQuestions={false}`, `showEvidence={false}`, and `useFallbacks={false}`;
- the focused assistant rail classes from `AssistantPanel`: `template-assistant-rail`, `template-assistant-shell`, `template-assistant-scroll`, and `template-assistant-panel`;
- an `assistant-recommendation` child with `assistant-recommendation-scroll` for content and `recommendation-actions compact ai-sample-actions` for actions.

## Blueprint

Blueprint should use the same page wrapper and focused assistant mode as Samples. Existing Blueprint AI actions remain available, but the right rail content should be rendered as a focused recommendation panel instead of a mixed questions/evidence panel.

## Files

Files should use the same page wrapper as Samples and keep its existing Files AI behavior. Its `FilesTechnicalAssistant` already uses the recommendation structure, so the key change is aligning the page grid and any spacing with the Samples assistant rail.

## Testing

Add focused tests that render Blueprint and Files steps and verify:

- the page wrapper includes `templates-content-grid` and `samples-content-grid`;
- the assistant rail includes `template-assistant-rail`;
- the assistant panel includes `template-assistant-panel`;
- Blueprint and Files still show their expected AI action buttons.
