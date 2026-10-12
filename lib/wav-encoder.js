/**
 * WAV and Audio Utility Encoder
 * Converts AudioBuffer to standard 16-bit PCM WAV Blob
 */
(function(window) {
  function encodeWAV(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    const buffer = new ArrayBuffer(44 + length * numChannels * 2);
    const view = new DataView(buffer);

    function writeString(offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    // RIFF chunk descriptor
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * numChannels * 2, true);
    writeString(8, 'WAVE');

    // fmt sub-chunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
    view.setUint16(32, numChannels * 2, true); // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample

    // data sub-chunk
    writeString(36, 'data');
    view.setUint32(40, length * numChannels * 2, true);

    // Write samples (interleaved)
    let offset = 44;
    const channels = [];
    for (let c = 0; c < numChannels; c++) {
      channels.push(audioBuffer.getChannelData(c));
    }

    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        let sample = channels[c][i];
        sample = Math.max(-1, Math.min(1, sample));
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  function encodeMP3(audioBuffer, bitrate = 320, onProgress = null) {
    if (!window.lamejs || !window.lamejs.Mp3Encoder) {
      console.warn('lamejs not loaded, falling back to WAV encoder');
      return encodeWAV(audioBuffer);
    }

    const numChannels = Math.min(2, audioBuffer.numberOfChannels);
    const sampleRate = audioBuffer.sampleRate;
    const mp3encoder = new window.lamejs.Mp3Encoder(numChannels, sampleRate, bitrate);
    const mp3Data = [];

    const left = audioBuffer.getChannelData(0);
    const right = numChannels > 1 ? audioBuffer.getChannelData(1) : left;
    const sampleCount = audioBuffer.length;

    const leftInt16 = new Int16Array(sampleCount);
    const rightInt16 = new Int16Array(sampleCount);

    for (let i = 0; i < sampleCount; i++) {
      let sL = Math.max(-1, Math.min(1, left[i]));
      leftInt16[i] = sL < 0 ? sL * 0x8000 : sL * 0x7FFF;

      let sR = Math.max(-1, Math.min(1, right[i]));
      rightInt16[i] = sR < 0 ? sR * 0x8000 : sR * 0x7FFF;
    }

    const chunkSize = 1152;
    for (let i = 0; i < sampleCount; i += chunkSize) {
      const leftChunk = leftInt16.subarray(i, i + chunkSize);
      const rightChunk = rightInt16.subarray(i, i + chunkSize);
      let mp3buf;
      if (numChannels === 1) {
        mp3buf = mp3encoder.encodeBuffer(leftChunk);
      } else {
        mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      }
      if (mp3buf && mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }
      if (onProgress && i % (chunkSize * 20) === 0) {
        onProgress(i / sampleCount);
      }
    }

    const endBuf = mp3encoder.flush();
    if (endBuf && endBuf.length > 0) {
      mp3Data.push(endBuf);
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
  }

  window.MurekaAudioUtils = {
    encodeWAV: encodeWAV,
    encodeMP3: encodeMP3
  };
})(window);
