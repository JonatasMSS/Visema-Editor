export function normalizeRanges(ranges) {
  return ranges
    .filter(({start, end}) => end > start)
    .sort((a, b) => a.start - b.start)
    .reduce((result, range) => {
      const last = result.at(-1);
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else result.push({...range});
      return result;
    }, []);
}

export function subtractRange(ranges, start, end) {
  return normalizeRanges(ranges.flatMap((range) => {
    if (end <= range.start || start >= range.end) return [range];
    return [
      {start: range.start, end: Math.min(start, range.end)},
      {start: Math.max(end, range.start), end: range.end},
    ].filter((part) => part.end - part.start >= 0.04);
  }));
}

export function removeTranscriptForRange(text, ranges, start, end) {
  const tokens = text.match(/\S+\s*/gu) || [];
  const total = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
  if (!tokens.length || total <= 0) return text;

  const timeAt = (position) => {
    let offset = position * total;
    for (const range of ranges) {
      const length = range.end - range.start;
      if (offset <= length) return range.start + offset;
      offset -= length;
    }
    return ranges.at(-1).end;
  };

  return tokens
    .filter((_, index) => {
      const time = timeAt((index + 0.5) / tokens.length);
      return time < start || time >= end;
    })
    .join('')
    .trimEnd();
}

export function keptDuration(ranges) {
  return ranges.reduce((sum, range) => sum + range.end - range.start, 0);
}

export function playableTime(time, ranges) {
  const containing = ranges.find((range) => time >= range.start && time < range.end);
  if (containing) return time;
  return ranges.find((range) => range.start > time)?.start ?? ranges[0]?.start ?? 0;
}
