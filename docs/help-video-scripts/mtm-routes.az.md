# Marşrutlar — ətraflı video-bələdçi (AZ)

## Məqsəd və format

Bu, qısa tanıtım videosu deyil. Video **12–15 dəqiqəlik praktik bələdçi**
olmalıdır: istifadəçi ekranda hər addımı görür, niyə etdiyini başa düşür və
sonra həmin prosesi özü təkrarlaya bilir.

Hədəf istifadəçilər:

- öz iş gününü planlayan sahə agenti;
- komandasının planını yaradan və yoxlayan menecer;
- prosesə yeni qoşulan, texniki təcrübəsi olmayan əməkdaş.

Video yalnız azərbaycan dilində hazırlanır. Ekrandakı proses sadə, canlı
nümunə ilə izah edilir; texniki sözlərdən və gizli "admin addımları"ndan
istifadə edilmir.

## İzləyicinin video sonunda bacarmalı olduğu iş

1. Hansı əməkdaş üçün və hansı tarixdə marşrut yaradacağını seçmək.
2. Müştərinin niyə namizədlərdə görünmədiyini anlamaq və onu düzgün təyin
   etmək.
3. Mövcud klinikanı elə marşrutun içində agentə təyin etmək, sonra həkim və
   apteki eyni marşruta əlavə etmək.
4. Dayanacaqların ardıcıllığını və vaxtlarını yoxlamaq.
5. Qaralamanın nə olduğunu və nə vaxt yayımlamaq lazım olduğunu bilmək.
6. Yayımlanmış marşrutun təqvimdə, həftəlik planda və agentin iş axınında
   harada göründüyünü anlamaq.

## Qeydiyyatdan əvvəl məcburi canlı yoxlama

Video yalnız aşağıdakı tam yol QA mühitində uğurla keçdikdən sonra yazılır.
Bu, dekorativ kliklər deyil, real server cavabları ilə yoxlanılan ssenaridir.

1. Ayrılmış `[QA-SWISSMED]` agentinə daxil olmaq.
2. Gələcək iş gününü seçmək.
3. Agentə təyin olunmuş həkimi və apteki namizədlərdə tapmaq.
4. Yalnız ayrılmış QA-SWISSMED qeydi ilə boş namizəd vəziyyətini açmaq,
   “Mövcud qeydi tap və təyin et” addımını həmin səhifədə bitirmək və
   namizədin yeniləndiyini görmək. Başqa səhifəyə keçid olmamalıdır.
5. Klinikadan, həkimdən və aptekdən ibarət üç dayanacaqlı marşrut yaratmaq və
   avtomatik vaxt planlamasını yoxlamaq.
6. Marşrutu qaralama kimi saxlamaq və yalnız həmin QA qaralamasını silmək.
7. Ayrılmış QA qaralamasını açmaq və yayımlamaq.
8. QA fixture-lərini yeniləyib növbəti qeydiyyat üçün ilkin vəziyyətə qaytarmaq.

Bu yoxlamalardan hər hansı biri uğursuz olsa, əvvəl səbəb aradan qaldırılır,
sonra video yazılır. Real müştəri, real agent və ya real marşrut dəyişdirilmir.

## Səhnə-səhnə ssenari

| № | Ekranda göstərilən real hərəkət | İzləyiciyə verilən əsas fikir |
| --- | --- | --- |
| 1 | `Marşrutlar` bölməsi açılır. | Bu videoda bir iş gününü sıfırdan planlayacağıq: agent, müştəri, vaxt, qaralama və yayımlama. İcazəsi olan agent öz planını da yarada bilər. |
| 2 | Təqvim görünüşü açılır. | Hər gün ayrıca xanadır; kartın rəngi marşrutun vəziyyətini göstərir. Kartın üzərinə basmaqla detallara keçilir. |
| 3 | `Həftə` görünüşü açılır. | Solda əməkdaşlar, yuxarıda günlərdir. Menecer bütün komandanı bir baxışda görür, agent isə yalnız hüququ çatan planla işləyir. |
| 4 | Boş namizəd vəziyyəti və “Mövcud qeydi tap və təyin et” düyməsi göstərilir. | Menecer həkimi, apteki və ya təşkilatı elə bu səhifədə tapır, təyin edir və marşruta əlavə edir; ayrıca kataloqa keçmir. Agentdə bu hüquq yoxdursa, sistem aydın şəkildə rəhbərə müraciət etməyi deyir. |
| 5 | `Marşrut əlavə et` düyməsi basılır. | Forma üç sadə addımdır: kim və nə vaxt, hara gedəcək, sonra vaxt və sıra yoxlanılır. Böyük aşağı düymə növbəti addımı göstərir. |
| 6 | Əsas əməkdaş və iş tarixi seçilir. | Tarix marşrutun yaradıldığı tarix deyil, agentin işləyəcəyi gündür. Sistem həmin agentin bazasını və mövcud planını avtomatik yoxlayır. |
| 7 | Əlavə parametrlər açılır; ad və qeyd yazılır. | Aydın ad menecerə məqsədi dərhal izah edir. İştirakçı və qeyd faydalıdır, amma məcburi deyil. |
| 8 | Müştəri seçimi hissəsi göstərilir. | Təşkilat, həkim və aptek ayrı seçimlərdir ki, axtarış qarışmasın. Ad, ünvan, telefon və ya kodla axtarmaq olur. |
| 9 | `Həkimlər` seçilir, həkim kartı marşruta əlavə edilir. | Yalnız seçilmiş agentə təyin olunan həkimlər görünür; kartdakı əlavə işarəsi həkimi dərhal marşruta gətirir. |
| 10 | `Apteklər` seçilir, aptek kartı əlavə edilir. | Bir marşrutda həkim, aptek və təşkilat ola bilər. Eyni obyektin iki dəfə əlavə olunması bloklanır. |
| 11 | `Filtrlər və plan yoxlaması` açılır. | Namizəd çoxdursa, rayon, şəhər, növ və ixtisasla siyahı daraldılır. Əvvəl agenti, tarixi və istiqaməti yoxlamaq lazımdır. |
| 12 | `Əlavəni bitir` və `Vaxtları planlaşdır` basılır. | Seçilən dayanacaqlar bir siyahıya keçir; sistem ilkin vaxt ardıcıllığını qurur, istifadəçi isə onu sonradan istədiyi kimi düzəldir. |
| 13 | Dayanacaqlar, vaxt sahələri, yuxarı/aşağı oxlar və silmə işarəsi göstərilir. | Saxlamazdan əvvəl əməkdaş, tarix, sıra və vaxtlar yoxlanır. Sıra və vaxtlar agentin gecikməməsi üçün vacibdir. |
| 14 | `Qaralamanı saxla` basılır. | Qaralama agentə göndərilmir. Plan hələ də düzəliş, əlavə və silmə üçün açıq qalır. |
| 15 | Qaralama kartı göstərilir. | Kartda əməkdaş, dayanacaqlar, xəritə və icra vəziyyəti görünür. Plan hələ razılaşdırılmayıbsa, onu yayımlamaq olmaz. |
| 16 | Siyahıda adla axtarış edilir və ayrılmış QA qaralaması açılır. | Uzun siyahıda axtarış sürətlə doğru planı tapır; `Bax` düyməsi bütün detalları açır. |
| 17 | `Marşrutu yayımla` düyməsi göstərilir. | Yayımlama son şüurlu addımdır: tarix, agent və dayanacaqlar düzgün olduqda agent planı görəcək. |
| 18 | Ayrılmış QA qaralaması yayımlanır. | Yayımlandıqdan sonra plan iş tapşırığıdır: agent dayanacaqlara gedir və ziyarətləri qeyd edir, menecer isə gedişi izləyir. |
| 19 | Təqvim və həftəlik plan yenidən açılır. | Yayımlanmış marşrut təqvimdə və agentin iş günündə görünür. Komanda görünürlüğü ayrıca məxfilik qaydası ilə idarə edilir. |
| 20 | Həftəlik plan üzərində yekun. | Gündəlik qayda: agent və tarix → təyin olunmuş müştəri → vaxt və sıra → qaralama → hazır olanda yayımlama. |

## Mütləq izah ediləcək iki vəziyyət

### Namizəd siyahısı boşdur

İzləyiciyə açıq deyilir: “Siyahı boşdursa, əvvəl əməkdaşı və tarixi yoxlayın.
Menecerdə ‘Mövcud qeydi tap və təyin et’ düyməsi görünür: həkimi, apteki və
ya təşkilatı həmin səhifədə axtarıb təyin etmək olur.” Qeyd başqa əməkdaşda
olarsa, köçürmə ayrıca təsdiq tələb edir. Agentdə bu hüquq yoxdursa, o kataloq
axtarmır: ekrandakı sadə xəbərdarlıq rəhbərə müraciət etməli olduğunu göstərir.
İstifadəçi marşrut səhifəsindən çıxıb haraya getməli olduğunu təxmin etmir.

### Qaralama və yayımlanmış marşrutun fərqi

- **Qaralama:** plan hələ hazırlanır, agentə göndərilmir, rahat redaktə olunur.
- **Yayımlanmış marşrut:** agentin iş gününə daxil olur və icra üçün nəzərdə
  tutulur.

Bu fərq bir dəfə yox, həm qaralamanı saxlayarkən, həm də yayımlayarkən təkrar
izah edilir.

## Səs, görüntü və keyfiyyət qaydası

- Səs yalnız azərbaycan dilində, aydın və sakit tempdə olur.
- Xarici Gemini TTS istifadə edilərsə, model
  `gemini-2.5-flash-preview-tts`, səs `Kore` olacaq; lokal TTS istifadə edilmir.
- Hər səs cümləsi ekrandakı real klik və ya nəticə ilə uyğunlaşır.
- Sabit `sleep` əvəzinə səhnə səsin real müddətinə uyğun saxlanılır; boş
  səssizlik yaranmır.
- Qeydiyyatdan sonra səhnələrin orta kadrları və səssiz uzun fasilələr ayrıca
  yoxlanılır.
- Video tamamlandıqdan sonra QA fixture yenilənir; demo üçün yaradılan və ya
  yayımlanan QA marşrutu növbəti yazılışda təmiz başlanğıc vəziyyətində olur.

## Qəbul meyarı

Video yalnız o halda hazır sayılır ki, yeni əməkdaş onu izlədikdən sonra
köməksiz olaraq bir agent üçün həkim və aptekdən ibarət marşrut yarada, onu
qaralama kimi saxlaya və nə vaxt yayımlamalı olduğunu düzgün izah edə bilsin.
