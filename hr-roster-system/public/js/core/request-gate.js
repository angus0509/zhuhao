(function initRequestGate(globalScope) {
  function createRequestGate() {
    let generation = 0;
    const sequences = new Map();

    return {
      begin(channel) {
        const sequence = (sequences.get(channel) || 0) + 1;
        sequences.set(channel, sequence);
        return { channel, sequence, generation };
      },
      isCurrent(request) {
        return request?.generation === generation
          && sequences.get(request.channel) === request.sequence;
      },
      invalidateAll() {
        generation += 1;
        sequences.clear();
      }
    };
  }

  globalScope.createRequestGate = createRequestGate;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createRequestGate };
})(typeof window !== 'undefined' ? window : globalThis);
