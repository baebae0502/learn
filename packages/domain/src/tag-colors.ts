export const TAG_COLORS = [
  { id: 'yellow', hex: '#ffd400', label: '노랑' },
  { id: 'red', hex: '#ff6666', label: '빨강' },
  { id: 'green', hex: '#5fb236', label: '초록' },
  { id: 'blue', hex: '#2ea8e5', label: '파랑' },
  { id: 'purple', hex: '#a28ae5', label: '보라' },
  { id: 'magenta', hex: '#e56eee', label: '자홍' },
  { id: 'orange', hex: '#f19837', label: '주황' },
  { id: 'gray', hex: '#aaaaaa', label: '회색' },
] as const;

export type TagColorId = (typeof TAG_COLORS)[number]['id'];
