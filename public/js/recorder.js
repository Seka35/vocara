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

    let onTimerUpdateCb = null;
    let onCompleteCb = null;
    let onErrorCb = null;

    function setCallbacks(callbacks) {
        onTimerUpdateCb = callbacks.onTimerUpdate;
        onCompleteCb = callbacks.onComplete;
        onErrorCb = callbacks.onError;
    }

    async function start() {
        try {
            recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            if (onErrorCb) onErrorCb("Microphone access denied or unavailable.");
            return false;
        }

        recordedChunks = [];
        let mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/mp4';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = '';
            }
        }

        mediaRecorder = mimeType ? new MediaRecorder(recordStream, { mimeType }) : new MediaRecorder(recordStream);
        mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = handleStop;
        mediaRecorder.start();

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

    return {
        setCallbacks,
        start,
        stop
    };
})();
