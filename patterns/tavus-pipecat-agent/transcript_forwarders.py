"""Data-channel transcript forwarders for the Tavus/Pipecat worker.

Nova Sonic is speech-to-speech: it streams audio, not a transcript panel. These
two processors tap the frames flowing through the pipeline and push
`{"type": "transcript", ...}` messages down to the transport's data channel so
the browser's existing transcript panel fills in as the conversation is spoken.

The message shape matches what the frontend's Tavus client adapter maps onto the
same `TranscriptUpdate` callback the LiveKit path already uses, so the panel code
is unchanged.

Only the Nova Sonic path is in scope. Nova Sonic emits one `LLMTextFrame` per
sentence within a response, so `AgentTranscriptForwarder` accumulates those
sentences across the response (delimited by the LLM full-response start/end
frames) rather than forwarding each verbatim.
"""

from pipecat.frames.frames import (
    InterimTranscriptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    OutputTransportMessageUrgentFrame,
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
    """Forward agent response text to the browser via the data channel.

    Nova Sonic (Pipecat 1.7.0) emits one ``LLMTextFrame`` PER SENTENCE within a
    response (``aggregated_by=SENTENCE``), not the full accumulated response. So
    the sentences must be accumulated across the response; forwarding each one
    verbatim made every sentence overwrite the previous one in the panel, and the
    viewer only ever saw the last sentence of each turn.

    The response is delimited by ``LLMFullResponseStartFrame`` /
    ``LLMFullResponseEndFrame``. Only ``LLMTextFrame`` is tapped — the service
    also emits ``AggregatedTextFrame`` and (deferred) ``TTSTextFrame`` carrying
    the same text, and counting those would duplicate every sentence.
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._buffer = ""
        self._sent_speaking = False

    async def _emit(self, text: str, final: bool) -> None:
        await self.push_frame(
            OutputTransportMessageUrgentFrame(
                message={"type": "transcript", "role": "agent", "text": text, "final": final}
            ),
            FrameDirection.DOWNSTREAM,
        )

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMFullResponseStartFrame):
            # New response → new bubble. Reset so sentences accumulate fresh.
            self._buffer = ""
            self._sent_speaking = False
        elif isinstance(frame, TTSStartedFrame):
            # Emit an empty non-final message once so the panel shows the agent
            # is speaking before the first sentence lands.
            if not self._sent_speaking and not self._buffer:
                await self._emit("", final=False)
                self._sent_speaking = True
        elif isinstance(frame, LLMTextFrame):
            piece = (frame.text or "").strip()
            if piece:
                # Accumulate sentences with a separating space (Nova Sonic marks
                # inter-sentence spacing on the TTS frames, not the text pieces).
                self._buffer = f"{self._buffer} {piece}".strip() if self._buffer else piece
                await self._emit(self._buffer, final=False)
        elif isinstance(frame, LLMFullResponseEndFrame):
            if self._buffer:
                await self._emit(self._buffer, final=True)
            self._buffer = ""
            self._sent_speaking = False

        await self.push_frame(frame, direction)
