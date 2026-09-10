"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

/**
 * `/contacts/list` переехал на `/contacts`.
 *
 * Раздел «Контакты» открывался аналитикой сегментов, а сам список жил на
 * отдельном адресе: в раздел заходят, чтобы найти человека, а получали
 * разбивку по категориям и источникам с нулями. Список занял корневой адрес,
 * аналитика уехала на `/contacts/segments`.
 *
 * Этот редирект остаётся, потому что на `/contacts/list` ссылаются письма,
 * закладки, справка на трёх языках и виджет сегментов на дашборде. Параметры
 * запроса переносятся: с дашборда сюда приходят с `?category=...`, и терять
 * фильтр по дороге нельзя.
 */
export default function ContactsListRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const query = searchParams.toString()
    router.replace(query ? `/contacts?${query}` : "/contacts")
  }, [router, searchParams])

  return null
}
