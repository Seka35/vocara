/**
 * Vocara Audio Recorder Module
 */
const Recorder = (function () {
    "use strict";

    const N_BINS = 64;
    const MAX_RECORD_MS = 20000;

    let mediaRecorder = null;
    let recordedChunks = [];
    let recordStream = null;
    let recordStartTs = 0;
    let timerInterval = null;
    let isRecordingState = false;

    let onStartCb = null;
    let onTimerUpdateCb = null;
    let onCompleteCb = null;
    let onErrorCb = null;

    function init(callbacks) {
        onStartCb = callbacks.onStart;
        onCompleteCb = callbacks.onStop || callbacks.onComplete;
        onTimerUpdateCb = callbacks.onTimer || callbacks.onTimerUpdate;
        onErrorCb = callbacks.onError;
    }

    function setCallbacks(callbacks) {
        onTimerUpdateCb = callbacks.onTimerUpdate || callbacks.onTimer;
        onCompleteCb = callbacks.onComplete || callbacks.onStop;
        onErrorCb = callbacks.onError;
        onStartCb = callbacks.onStart;
    }

    async function toggleRecording() {
        if (!isRecordingState) {
            const ok = await start();
            return ok;
        } else {
            stop();
            return true;
        }
    }

    async function start() {
        try {
            recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            if (onErrorCb) onErrorCb("Microphone access denied or unavailable.");
            return false;
        }

        recordedChunks = [];
        const supportedTypes = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'];
        let mimeType = '';
        for (const type of supportedTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                mimeType = type;
                break;
            }
        }

        mediaRecorder = mimeType ? new MediaRecorder(recordStream, { mimeType }) : new MediaRecorder(recordStream);
        mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = handleStop;
        mediaRecorder.start();

        isRecordingState = true;
        if (onStartCb) onStartCb();

        recordStartTs = Date.now();
        timerInterval = setInterval(() => {
            const elapsed = Date.now() - recordStartTs;
            if (onTimerUpdateCb) onTimerUpdateCb(elapsed);
            if (elapsed >= MAX_RECORD_MS) { stop(); }
        }, 100);

        return true;
    }

    function stop() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        if (recordStream) {
            recordStream.getTracks().forEach(t => t.stop());
        }
        clearInterval(timerInterval);
        isRecordingState = false;
    }

    async function handleStop() {
        const mime = (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm';
        const blob = new Blob(recordedChunks, { type: mime });

        if (blob.size === 0) {
            if (onErrorCb) onErrorCb("No sound recorded. Please try again.");
            return;
        }

        try {
            const arrayBuffer = await blob.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
            const fingerprint = computeFingerprint(audioBuffer, N_BINS);
            const duration = audioBuffer.duration;

            if (onCompleteCb) {
                onCompleteCb({
                    blob,
                    mime,
                    duration,
                    fingerprint
                });
            }
        } catch (e) {
            console.error(e);
            if (onErrorCb) onErrorCb("Failed to process audio recording.");
        }
    }

    function computeFingerprint(audioBuffer, nBins) {
        const ch0 = audioBuffer.getChannelData(0);
        let data = ch0;
        if (audioBuffer.numberOfChannels > 1) {
            const ch1 = audioBuffer.getChannelData(1);
            const mixed = new Float32Array(ch0.length);
            for (let i = 0; i < ch0.length; i++) mixed[i] = (ch0[i] + ch1[i]) / 2;
            data = mixed;
        }

        const total = data.length;
        const binSize = Math.max(1, Math.floor(total / nBins));
        const bins = new Array(nBins).fill(0);

        for (let b = 0; b < nBins; b++) {
            const start = b * binSize;
            const end = (b === nBins - 1) ? total : Math.min(total, start + binSize);
            let sumSq = 0, count = 0;
            for (let i = start; i < end; i++) {
                sumSq += data[i] * data[i];
                count++;
            }
            bins[b] = count > 0 ? Math.sqrt(sumSq / count) : 0;
        }

        const max = Math.max(...bins, 1e-6);
        return bins.map(v => Math.max(0, Math.min(1, v / max)));
    }

    async function processAudioFile(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            const fingerprint = computeFingerprint(audioBuffer, N_BINS);
            const duration = audioBuffer.duration;
            const blob = new Blob([arrayBuffer], { type: file.type || 'audio/webm' });

            return {
                blob,
                mime: file.type || 'audio/webm',
                duration,
                fingerprint
            };
        } catch (e) {
            console.error("Audio decoding error:", e);
            throw new Error("Unable to decode audio file. Please upload a valid MP3, WAV, or M4A file.");
        }
    }

    return {
        init,
        toggleRecording,
        isRecording: () => isRecordingState,
        setCallbacks,
        start,
        stop,
        processAudioFile
    };
})();
