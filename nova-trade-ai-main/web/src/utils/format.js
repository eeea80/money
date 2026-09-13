export function formatDateTime(value) {
  if (!value) return '暂无记录'
  const normalized = value.replace('T', ' ')
  return normalized.length >= 16 ? normalized.slice(0, 16) : normalized
}

export function avatarText(user) {
  const name = user?.nickname || user?.username || 'N'
  return [...name][0]?.toUpperCase() || 'N'
}
