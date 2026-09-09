/**
 * Свёртка повторов родительского медиа внутри ветки комментариев.
 *
 * Прод, август 2026: под одним TikTok-видео накопилось 275 комментариев (124 из
 * них негативные), под facebook-рилсом — 190. Лента рисует каждый комментарий
 * отдельной карточкой и тащит в неё родительский плеер, поэтому при сортировке
 * «сначала негатив» одно и то же видео повторялось десятками экранов подряд.
 *
 * Правило: медиа показывает первая карточка ветки, а следующие с ТЕМ ЖЕ медиа
 * его не повторяют. Совпадение проверяется по ключу медиа, а не по факту
 * принадлежности к ветке, — собственная картинка комментария так не потеряется.
 * Проверка идёт по всей странице, а не по соседней строке: при сортировке по
 * тональности комментарии одной ветки перемежаются чужими.
 */
export type MentionThreadRow = {
  id: string
  /** Ссылка на родительский пост; null для самостоятельных находок. */
  parentUrl: string | null
  /** Медиа, которое карточка показала бы встроенным плеером или превью. */
  inlineMediaKey: string | null
}

export type MentionThreadCollapse = {
  /** Первая карточка каждой ветки — единственная, где уместен её размер. */
  threadLeadIds: Set<string>
  /** Карточки, которым не надо повторять уже показанное медиа ветки. */
  repeatedMediaIds: Set<string>
}

export function collapseThreadMediaRepeats(rows: MentionThreadRow[]): MentionThreadCollapse {
  const threadLeadIds = new Set<string>()
  const repeatedMediaIds = new Set<string>()
  const seenThreads = new Set<string>()
  const shownMediaByThread = new Map<string, string>()
  for (const row of rows) {
    if (!row.parentUrl) {
      threadLeadIds.add(row.id)
      continue
    }
    if (!seenThreads.has(row.parentUrl)) {
      seenThreads.add(row.parentUrl)
      threadLeadIds.add(row.id)
      if (row.inlineMediaKey) shownMediaByThread.set(row.parentUrl, row.inlineMediaKey)
      continue
    }
    if (!row.inlineMediaKey) continue
    // Ведущая карточка ветки могла быть без медиа — тогда плеер впервые
    // показывает вот эта, а сворачиваются уже следующие такие же.
    if (!shownMediaByThread.has(row.parentUrl)) shownMediaByThread.set(row.parentUrl, row.inlineMediaKey)
    else if (shownMediaByThread.get(row.parentUrl) === row.inlineMediaKey) repeatedMediaIds.add(row.id)
  }
  return { threadLeadIds, repeatedMediaIds }
}
