"""Data-channel transcript forwarders for the Tavus/Pipecat worker.

Nova Sonic is speech-to-speech: it streams audio, not a transcript panel. These
two processors tap the frames flowing through the pipeline and push
`{"type": "transcript", ...}` messages down to the transport's data channel so
the browser's existing transcript panel fills in as the conversation is spoken.

The message shape matches what the frontend's Tavus client adapter maps onto the
same `TranscriptUpdate` callback the LiveKit path already uses, so the panel code
is unchanged.

Only the Nova Sonic path is in scope. Nova Sonic emits each agent `TextFrame`
already containing the full accumulated text, so `AgentTranscriptForwarder` runs
with `accumulate=False` and forwards verbatim (mirrors the reference's Nova Sonic
branch).
"""

from pipecat.frames.frames import (
    InterimTranscriptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    OutputTransportMessageUrgentFrame,
    TextFrame,
    TranscriptionFrame,
    TTSStartedFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


class UserTranscriptForwarder(FrameProcessor):
    """Forward user STT transcriptions to the browser via the data channel.

    Nova Sonic pushes `TranscriptionFrame` UPSTREAM for user speech, so this
    processor must sit between the LLM and the context aggregator to intercept
    the frame before the aggregator consumes it (see the pipeline order in
    tavus_pipecat_agent.py).
    """

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            await self.push_frame(
                OutputTransportMessageUrgentFrame(
                    message={"type": "transcript", "role": "user", "text": frame.text.strip(), "final": True}
                ),
                FrameDirection.DOWNSTREAM,
            )
        elif isinstance(frame, InterimTranscriptionFrame) and frame.text.strip():
            await self.push_frame(
                OutputTransportMessageUrgentFrame(
                    message={"type": "transcript", "role": "user", "text": frame.text.strip(), "final": False}
                ),
                FrameDirection.DOWNSTREAM,
            )

        await self.push_frame(frame, direction)


class AgentTranscriptForwarder(FrameProcessor):
    """Forward agent LLM text to the browser via the data channel.

    For Nova Sonic (`accumulate=False`) each `TextFrame` already carries the full
    accumulated text, so it is forwarded verbatim. The accumulate path is kept
    only for symmetry with the reference and is unused here.
    """

    def __init__(self, accumulate: bool = False, **kwargs):
        super().__init__(**kwargs)
        self._accumulate = accumulate
        self._buffer = ""
        self._sent_speaking = False

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMFullResponseStartFrame):
            self._buffer = ""
            self._sent_speaking = False
        elif isinstance(frame, TTSStartedFrame):
            if not self._sent_speaking and not self._buffer.strip():
                await self.push_frame(
                    OutputTransportMessageUrgentFrame(
                        message={"type": "transcript", "role": "agent", "text": "", "final": False}
                    ),
                    FrameDirection.DOWNSTREAM,
                )
                self._sent_speaking = True
        elif isinstance(frame, TextFrame):
            if self._accumulate:
                self._buffer += frame.text
                text = self._buffer.strip()
            else:
                text = frame.text.strip()
                self._buffer = text
            if text:
                await self.push_frame(
                    OutputTransportMessageUrgentFrame(
                        message={"type": "transcript", "role": "agent", "text": text, "final": False}
                    ),
                    FrameDirection.DOWNSTREAM,
                )
        elif isinstance(frame, LLMFullResponseEndFrame):
            if self._buffer.strip():
                await self.push_frame(
                    OutputTransportMessageUrgentFrame(
                        message={"type": "transcript", "role": "agent", "text": self._buffer.strip(), "final": True}
                    ),
                    FrameDirection.DOWNSTREAM,
                )
            self._buffer = ""
            self._sent_speaking = False

        await self.push_frame(frame, direction)
