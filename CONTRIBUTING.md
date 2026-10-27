# Contributing to Soundboard

Soundboard is an independently maintained BetterDiscord plugin focused on custom audio playback during Discord voice calls.

Bug fixes, improvements, and new ideas are welcome. Contributions should prioritize reliable playback, predictable controls, and compatibility with existing user settings.

Before submitting changes, make sure you understand the behavior you are modifying and have verified your implementation. Contributors are responsible for the quality and testing of their submissions.

## Reporting Bugs

If Soundboard is not working as expected, open an [Issue](https://github.com/8ug8ird/Soundboard/issues/new).

A useful bug report should provide:

- Soundboard, BetterDiscord, and Discord versions.
- A clear explanation of what went wrong.
- Steps that consistently reproduce the issue.
- What you expected to happen and what happened instead.
- Relevant DevTools console errors (`Ctrl+Shift+I`).
- Screenshots or recordings when they help illustrate the problem.

For audio-related problems, specify whether the issue occurs during local previews, voice calls, or both. Mention any relevant microphone, mute, or playback settings.

Before reporting a bug, check whether it also occurs with other plugins disabled. Avoid including private conversations, personal audio, or sensitive information in diagnostic attachments.

Reports without enough information to reproduce the problem may not be actionable.

## Suggesting Improvements

Have an idea for a new feature or a better way to handle something? Start a [Feature Request](https://github.com/8ug8ird/Soundboard/issues/new).

Explain the use case, how your suggestion would improve Soundboard, and whether it changes existing functionality.

Suggestions related to audio management, playback behavior, keyboard shortcuts, volume controls, and usability are especially relevant to the project.

Keep in mind that additional features also introduce maintenance costs. Changes that unnecessarily complicate the plugin or interfere with existing functionality may not be accepted.

For significant changes, discuss the approach before investing time in implementation.

## Pull Requests

Contributions should be focused, understandable, and ready for review.

To contribute code, fork the repository, create a branch for your changes, and submit a [Pull Request](https://github.com/8ug8ird/Soundboard/pulls).

When preparing a pull request:

- Keep changes limited to the issue or feature being addressed.
- Explain the motivation behind the implementation.
- Follow the existing JavaScript structure and coding conventions.
- Avoid unrelated formatting changes, unnecessary dependencies, or large refactors without a clear benefit.
- Preserve compatibility with existing sounds, hotkeys, and saved preferences.
- Remove temporary debugging code and incomplete implementations.
- Update relevant documentation when user-facing behavior changes.

A pull request should contain a complete implementation rather than an unfinished solution that depends on the maintainer to resolve basic problems.

Changes involving Discord internals, voice connections, or audio processing deserve particular care because seemingly small modifications can affect unrelated functionality.

## Testing and Verification

Soundboard interacts directly with Discord's audio behavior. Code inspection alone cannot establish that these interactions work correctly.

Contributors must test changes according to the functionality they affect.

### Audio and Playback

When modifying sound handling, verify the relevant scenarios:

- Importing, playing, previewing, and removing audio files.
- Playback during an active Discord voice call.
- The distinction between private previews and audio sent to the call.
- Individual sound volume and master volume adjustments.
- The **Hear my sounds** option.
- Stopping active sounds and triggering repeated playback.
- Behavior when joining, leaving, or switching voice channels.
- Microphone mute behavior and audio recovery after reconnecting.

Test with different audio files when format compatibility or decoding behavior is affected.

### Hotkeys and Interface

Changes to controls or the soundboard interface should be checked for:

- Correct keyboard and mouse shortcut registration.
- Duplicate or conflicting hotkey assignments.
- Shortcuts working while Discord is not focused.
- Consistent sound names, controls, and displayed values.
- Settings remaining intact after restarting Discord.
- Correct cleanup when the plugin is disabled or reloaded.

UI changes should remain usable across different window sizes.

### Stability and Compatibility

For changes involving plugin lifecycle, saved data, or Discord internals, verify that:

- Existing sound libraries and preferences remain accessible.
- Audio files are not unintentionally overwritten or lost.
- Plugin patches, event listeners, and audio resources are properly released.
- Disabling Soundboard does not leave active shortcuts or modified audio behavior behind.
- The DevTools console does not show unexpected errors or repeated failures.

Runtime testing should use the actual Discord desktop client with BetterDiscord whenever the change depends on Discord functionality.

### Documenting Test Results

Every pull request that changes functionality should include a short test summary explaining what was checked and what the results were.

Mention any scenarios that could not be tested. Screenshots, recordings, and relevant console output are encouraged when they help demonstrate the implementation.

Do not claim that a feature was tested simply because the code appears correct or an automated check passed.

If changes are made after testing or review feedback, repeat the affected tests against the updated code.

## AI-Assisted Development

AI-assisted contributions are allowed, provided the contributor understands and verifies the submitted implementation.

Generated code is not automatically reliable, particularly when interacting with Discord's internal APIs, audio streams, or BetterDiscord functionality.

If you use AI tools:

- Examine the entire generated diff before submitting it.
- Verify that referenced APIs, methods, and properties actually exist.
- Understand how the implementation affects audio routing, playback, and plugin lifecycle.
- Look for unnecessary complexity, unused code, and unintended side effects.
- Test the resulting behavior in the appropriate environment.
- Be prepared to explain and maintain the submitted code.

AI-generated explanations, simulated test results, and assumptions are not substitutes for actual verification.

Using AI does not transfer responsibility for bugs, compatibility problems, or incomplete implementations to the maintainer.

## Code Quality

Soundboard should remain straightforward to use and maintain.

Favor targeted solutions over unnecessary abstractions. Preserve established behavior unless the purpose of the change is to modify it.

Pay particular attention to resource cleanup, asynchronous operations, error handling, and the persistence of user data.

Avoid introducing changes that make the plugin unnecessarily dependent on specific Discord internals when a simpler and more reliable alternative exists.

Compatibility and stability are more valuable than adding complexity for its own sake.

## Review and Acceptance

All pull requests are subject to maintainer review. Submission does not guarantee acceptance.

A contribution may require additional testing, implementation changes, or further discussion before it can be merged.

Pull requests may be closed if they introduce regressions, lack sufficient verification, fall outside the project's goals, or create unreasonable maintenance requirements.

Review feedback is intended to improve the proposed change. Contributors are expected to investigate reported problems and address their causes rather than applying superficial fixes.

Clear explanations, accurate testing information, and well-scoped changes help keep the review process productive.
