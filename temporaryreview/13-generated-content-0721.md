# Generated content — 2026-07-21 · full batch, with image recommendations

**The run, honestly.** Today's trends (YouTube/Google) resolved only to **TMDB** (title + date + poster) — too thin, so M3 correctly refused to fabricate (only 少林足球 squeaked out one reflective post; see the "trend-path" note at the bottom). So I pulled the **rich path** you approved: re-ran M2's **article feeds** (自由娛樂 · Yahoo電影/FTNN · 放映週報 · 娛樂重擊 + English trades) → **209 fresh `source_events`** → fed 10 distinct works to M3 → **8 drafts**.

**What "image recommendation" means here:** for each post, below the copy, there's a **🎨 image imagination** — a described *idea* you can shoot on a phone, mock up, or hand to an AI. It is NOT the bare one-line prompt M3 auto-stores (those are inconsistent — some even carry English palette text, which would break the TC-only-on-image rule if used literally). All grounded in the page `visual_md`: **Deep Navy `#1E2430`** base · **Muted Blue `#6B7A8F`** accent · **Soft Gray `#BFC3C9`** · **Warm White `#F8F8F8`**. Mood: calm, late-night, low light, soft glow, cinematic. **On-image text: Traditional Chinese only, never English (hard rule 5).**

## The 8 drafts

| # | id | Pillar | Range | Chars | Subject |
|---|---|---|---|---|---|
| 1 | 6 | 後勁 aftertaste | 600–1000 | **597 ✗** | 少林足球（2001）· 阿梅沒說出口的暗戀 |
| 2 | 8 | 戰場 the_argument | 800–1200 | **743 ✗** | 王祖賢 授權 AI 重現小倩 |
| 3 | 12 | 幕後 behind_the_scenes | 800–1500 | **737 ✗** | 奧德賽（2026）全片 IMAX 的代價 |
| 4 | 13 | 數字 the_numbers | 400–900 | 433 ✓ | 奧德賽 打破自己的開片紀錄 |
| 5 | 7 | 正在燒 burning_now | 150–400 | 187 ✓ | 復仇者聯盟：末日崛起 預告 **(trend tie)** |
| 6 | 9 | 正在燒 burning_now | 150–400 | 206 ✓ | 奧德賽 首週 2.64 億 |
| 7 | 10 | 正在燒 burning_now | 150–400 | 211 ✓ | 毛骨悚然的戀愛 新劇混戰 |
| 8 | 11 | 正在燒 burning_now | 150–400 | 177 ✓ | 幸福快樂的日子 闖多倫多影展 |

**Read before you review:**
- **Each post carries the 片名（年份）/ 導演 / 主演 block (hard rule 2).** Movie-name-with-year is also inside every caption and stored structurally as `entity`+`movie_year`. Director + 主演 are **not** M3 output fields — they're derived from each article's evidence, marked **—** where the source never named them (hard rule 6, never from model knowledge). If you want director/star guaranteed on every draft, that's a small addition to M3's `DraftJson` + prompt — I'll spec it in Linear first on your say-so.
- **3 posts are flagged `range_violation` (all UNDER the floor: 597/743/737).** The validator auto-revised once and still landed short — surfaced, not hidden. They read complete; they're just below the pillar's minimum length. Easy manual top-up or a re-gen.
- **奧德賽 (Nolan's record opening) legitimately spans 3 pillars** (numbers/behind/burning) — it genuinely dominated today's film news, same as it did in file 12. Different pillars on the same movie is allowed by the dedup gate.
- **burning_now is over-represented (4×)** — today's feed is breaking-news heavy, so the model kept picking "ride the wave." If you want fewer, keep #5 (trend tie) + one of #6/#7/#8.
- **⚠️ Typo in draft #3's title:** 「全片**IMBX**的代價」 → should be **IMAX**. Fix before publishing.
- **Not covered:** 回憶殺 nostalgia (today's resurfacing material was death-heavy — 謝賢/翁倩玉母親 — which routes to a human, not a post) and 生活 lifestyle (needs zero evidence; the model won't pick it off a news article).

---

## 1 · 後勁 (aftertaste) · 597 ✗ · `item 6`

- **viral caption (in image):** 「記住的，是那雙揉麵的手」
- **title:** 少林足球的殘影
- **full caption:**
深夜看完的隔天早上，腦子裡還是甩不掉阿梅蒸饅頭的那雙手。

不是踢球的鏡頭，不是全國大賽的高潮，是她在小攤子後面，一個人揉麵，眼神偷偷瞄向星，卻又立刻低下頭去的那個瞬間。那個動作重複了好幾次，每一次都像是把話吞回去。

《少林足球（2001）》表面上是一部熱血逆襲片，一群荒廢多年的少林師兄弟靠著周星馳飾演的星重新找回絕技，把功夫融進足球裡，看的時候整個人都跟著熱血沸騰。可是散場之後，留在我心裡的不是那些誇張到近乎卡通的招式，而是趙薇演的阿梅，那個因為長得醜而不敢跟星表白的饅頭皇后。

我一直在想，為什麼一部這麼吵、這麼誇張的喜劇，最後讓我安靜下來的反而是這條幾乎沒什麼台詞的感情線。可能是因為，比起主角一路開外掛的逆襲，阿梅那種明明喜歡卻選擇沉默的心情，更像是普通人真實的樣子。星在球場上可以一夕之間找回天賦，阿梅卻沒辦法一夕之間變得有自信，這種落差反而讓整部片多了一點重量。有點笨拙、有點卑微，卻也真實得讓人心疼。

當然，這片子本來就不是拍給人細細品味感情線的，笑點才是主場，阿梅的故事線某種程度上也只是配菜，處理得不算細膩，甚至有點被喜劇的節奏犧牲掉，很多情緒都停在半路，沒有機會被好好說完。可是就是這種沒被好好講完的感覺，反而讓我一直記到現在，好像替她把那句沒說出口的話，一直留到了現在。🌙

不知道大家看完少林足球，最後留下來的是哪一幕。是進球的瞬間，還是某個沒被說出口的心事？

- **movie name（year）:** 少林足球（2001）
- **director:** —（TMDB 大綱未載明）
- **movie star:** 周星馳（飾星）、趙薇（飾阿梅）〔註：趙薇 見於文案，不在 TMDB 證據內〕
- **hashtags:** #少林足球 #後勁 #周星馳 #深夜看片 · **source:** tmdb_search 劇情大綱

### 🎨 image imagination
The post is about the *residue*, not the match — so the image must NOT be soccer. Show the quiet after. A bamboo steamer of plain white 饅頭 gone **cold** on a small stainless street-stall counter at night; one bun half-unwrapped and set slightly apart. In the deep, out-of-focus background, a tiny old TV glows an indistinct green pitch — a blur of light only, never legible. One warm lamp from the left; everything else falls into navy shadow; no steam (that's the point — it's cold now). **Manual:** shoot it on a phone, slightly underexposed, no filter — the imperfect realism *is* the aesthetic. **AI:** "late-night still life, cold steamed buns in a bamboo steamer on a stainless food-stall counter, one half-unwrapped, deep navy background, one warm lamp glow, a faint out-of-focus green glow in the far background, cinematic, melancholic, film grain, no text." Overlay 「記住的，是那雙揉麵的手」small, lower third, soft-gray. **Avoid:** the TMDB poster, bright color, English, comedy energy.

---

## 2 · 戰場 (the argument) · 743 ✗ · `item 8`

- **viral caption (in image):** 「靈氣，複製得出來嗎？」
- **title:** AI小倩該不該存在
- **full caption:**
王祖賢息影22年，這次消息是她把肖像授權給中國遊戲網易天下手遊，讓AI重現當年小倩、白蛇的模樣，拍成廣告片。消息一出，網路上直接吵起來，反應兩極，而且吵得比想像中激烈。

支持方的說法是，這算是一種致敬。技術上能讓老粉絲重新看到那個經典形象，讓角色不至於被時間淹沒，總比什麼都沒有好，而且本人親自授權，代表她自己也認可這個呈現方式。這一派的邏輯其實蠻務實的，說穿了就是能看到總比看不到好，何況授權這件事本身就代表當事人沒有排斥。

反對方的聲音更直接一點，批評AI重現「沒活人感」，說那個眼神、那種靈氣是複製不出來的，說到底只是拿明星的臉去做行銷素材，跟真正的表演沒什麼關係，甚至有點消費的意味在。這一派在意的不是能不能做，而是做了之後，那個東西還算不算是原本的角色，還是只是一張借用臉孔的廣告立牌。

其實仔細看這兩邊，吵的可能不是同一件事。一邊在討論「能不能被看見」，關心的是曝光和懷舊；一邊在討論「值不值得被看見」，在意的是尊重和靈魂。這是兩個不同層次的問題，只是被包在同一則新聞裡一起爆發，難怪吵起來誰也說服不了誰，因為根本不是在回答同一個題目。

老實說，我自己是有點偏向保留派的。小倩之所以讓人記得，是因為那個瞬間的表演，是活人的呼吸跟眼神，AI再怎麼精緻，複製出來的終究是一個殼子，少了那口氣。但也得承認，如果本人願意授權，這終究是她自己的選擇，外人要挑剔的立場其實蠻薄弱的，而且技術上確實能讓新世代認識這個角色，不完全沒有意義，至少比被徹底遺忘來得好一點。

只是我還是會想，如果哪天所有經典角色都能被AI複製重現，那我們懷念的到底是那個角色，還是那個真正演出來的人。這個問題好像沒有標準答案，但每次想到都覺得有點微妙。

這次的AI小倩，你會想看嗎？想看，還是不想看？

- **movie name（year）:** —（藝人動態，非單一作品；文中提及經典角色 小倩、白蛇）
- **director:** —
- **movie star:** 王祖賢
- **hashtags:** #王祖賢 #小倩 #AI爭議 · **source:** 自由娛樂 2026-07-21（網易天下手遊 AI 廣告授權）

### 🎨 image imagination
The debate is "can 靈氣 (spirit) be copied," so make the image the debate. One vertical frame split by a soft seam down the middle: **left**, a warm, soft-focus portrait silhouette with a painterly film-still glow (the *remembered* 小倩 — evoked, a silhouette, never a real photo of her); **right**, the same silhouette breaking apart into cold blue mosaic/pixel fragments. The seam is where the argument lives. **Manual:** shoot a portrait through textured glass, duplicate it, apply a heavy mosaic to one half. **AI:** "a woman's silhouette, left half soft warm-focus film still, right half dissolving into cold blue pixel fragments, deep navy background, moody, cinematic, no face detail." Overlay the fork 「靈氣，複製得出來嗎？」low-center, warm white. **Avoid:**王祖賢's real face/photo (rights + the point is evocation), English.

---

## 3 · 幕後 (behind the scenes) · 737 ✗ · `item 12` · ⚠️ fix title typo IMBX→IMAX

- **viral caption (in image):** 「半年，換那幾秒的真」
- **title:** 全片IMBX的代價  ← **change to 全片IMAX的代價**
- **full caption:**
看到這則幕後花絮的時候，我第一個反應不是「哇好猛」，而是「原來現在還有導演敢這樣拍」。這種反應說出來自己都覺得有點怪，畢竟現在特效技術已經進步到什麼都能後製，願意花這種力氣的人反而顯得不合時宜。

《奧德賽（2026）》是影史第一部全片用IMAX攝影機拍攝的電影，這句話寫起來輕描淡寫，但代表的是整整半年的拍攝期，沒有捷徑可走。IMAX攝影機笨重、對環境要求極高，收音、移動、對焦每一項都比一般攝影機麻煩十倍，諾蘭選擇不妥協，於是苦的是演員。想像一下每天扛著那種規格的設備進出場景，光是拍攝節奏就會被硬生生拖慢，這不是輕鬆的決定。

報導裡提到，「小蜘蛛」開拍第一天就自信全無，千黛亞在極端氣候下凍到失語，連麥特戴蒙都因為手臂上的刺青被嫌棄，得想辦法處理。這些細節單獨看很像八卦，隨手滑過去就沒了，但湊在一起就有意思了：一個是新手心態的崩解，一個是身體對氣候的直接反抗，一個是連身上的痕跡都要為電影讓路。三種挫折，其實都指向同一件事，就是這部片對「真實」的執念，大到連刺青都不放過，連演員的心理狀態都算進去。

我承認我對這種「用蠻力換質感」的拍法有點著迷，但也會忍不住想，半年的拍攝期，凍到失語的千黛亞，值不值得換來大銀幕上那幾秒鐘的真實感。那幾秒鐘觀眾可能根本感覺不出差別，但對演員來說是實打實的半年人生。我沒辦法替他們回答，只能說，這種賭注本身就很諾蘭，賭的不只是票房，還有整個劇組的身心狀態。

比較誠實地講，這類幕後消息通常會被包裝成「敬業感人」，媒體愛用這種角度收尾，但我更好奇的是，這樣的拍攝方式，對演員來說到底是磨練還是折磨，界線常常很模糊，外人只看得到成品，看不到過程裡那些崩潰的瞬間。

你們有沒有印象特別深的拍攝幕後故事，那種讓你重新看待一部片的細節？

- **movie name（year）:** 奧德賽（2026）
- **director:** 克里斯多福·諾蘭
- **movie star:** 麥特戴蒙、千黛亞、湯姆霍蘭德（小蜘蛛）
- **hashtags:** #奧德賽 #諾蘭 #幕後花絮 · **source:** Yahoo電影/FTNN 2026-07-20（拍攝幕後：IMAX 全片、演員實錄）

### 🎨 image imagination
The theme is "brute force for a few real seconds." A single hulking **IMAX camera silhouette** alone on an empty, storm-grey set at first light — human-scale tiny beside it, one crew light raking cold across the body, a hint of frost in the air. The emptiness carries the half-year grind. **Manual:** hard to shoot a real rig — better to use a stylized camera-silhouette graphic or a stock camera outline recolored to the palette. **AI:** "a lone large film camera silhouette on an empty stormy film set at dawn, cold blue light, frost in the air, deep navy tones, warm white glint on the lens, cinematic, moody, no text, no people." Keep it **text-light** (behind-the-scenes is reflective); if any, small 「半年，換那幾秒」corner. **Avoid:** a glossy hero shot, English, and — obviously — the IMBX typo.

---

## 4 · 數字 (the numbers) · 433 ✓ · `item 13`

- **viral caption (in image):** 「2.64 億 · 打破的是自己」
- **title:** 諾蘭打破自己的紀錄
- **full caption:**
台灣這幾天動態上應該常滑到《奧德賽（2026）》的討論，不管是IMAX一位難求還是特殊廳排隊排到門口。不過真正讓好萊塢在意的，不是排片盛況，是一個數字。

根據CNBC報導，這部片首週末全球票房衝到2.6億美元，刷新了克里斯多福諾蘭自己執導生涯的最佳開片紀錄。也就是說，這次不是打破別人的紀錄，是打破自己過去的成績。

Box Office Theory創辦人、Fandango分析部門主管羅賓斯有句話講得很妙：「死亡、繳稅，以及克里斯多福諾蘭，是人生不可避開的3件大事。」放在票房脈絡裡聽，與其說是恭維，更像是產業內部對他號召力的一種無奈承認，不管題材多硬、片長多長，觀眾就是會進場。

但說真的，這個數字講的是首週末的爆發力，不是後勁，也不是這部片十年後會不會被記得。開片紀錄跟口碑後勁，從來是兩件事，接下來幾週的票房跌幅，才會告訴我們這波是一次性衝票，還是真的撐得住的口碑發酵。

想問問大家，你們是「諾蘭新片一定衝第一週」的類型，還是習慣等口碑穩了再進場？🎬

- **movie name（year）:** 奧德賽（2026）
- **director:** 克里斯多福·諾蘭
- **movie star:** —（票房報導，來源未列演員）
- **hashtags:** #奧德賽 #諾蘭 #票房紀錄 · **source:** Yahoo電影 2026-07-20（CNBC 轉引，2.6 億首週末）

### 🎨 image imagination
Numbers pillar = **one** twist stat, clean. A moody, minimal data-viz: a single line (or bar) rising sharply across a navy field to a peak, the **peak point glowing warm white**, soft-gray grid faint behind. The whole frame is dark and cinematic, not corporate-bright. The one number 「2.64億」set large in warm white, a small line 「打破的是自己」beneath. **Manual:** build it in Figma/Canva with the four palette hex values. **AI:** generate a minimalist dark rising-line chart backdrop, then typeset the Chinese number on top yourself. **Avoid:** multi-color charts, English axis labels, any clutter — one number, one rise.

---

## 5 · 正在燒 (burning now) · 187 ✓ · `item 7` · **trend tie → this morning's #2**

- **viral caption (in image):** 「你卡在哪一幀？」
- **title:** 末日崛起預告後的半夜暫停鍵
- **full caption:**
《復仇者聯盟：末日崛起（2026）》預告一放出來，我半夜還在滑那三十秒，美隊跟雷神對到眼的那個鏡頭，重播了三次。羅素兄弟這次感覺不是在比特效量，是在比誰的沉默秒數抓得準。大家都在講「整個宇宙回來了」，但我更在意的是，剪輯怎麼把久違的重量塞進這麼短的畫面裡還不覺得擠。也可能是我太累腦補太多，但那個停頓真的抓得很準，準到有點犯規。你們卡在哪一幀，是那個對眼，還是後面那個轉場？

- **movie name（year）:**   復仇者聯盟：末日崛起（2026)
- **director:** 羅素兄弟
- **movie star:** —（預告報導未列演員本名；文中提及角色 美國隊長、雷神索爾）
- **hashtags:** #復仇者聯盟 #漫威預告 · **source:** 自由娛樂 2026-07-21（末日崛起首支正式預告釋出）

### 🎨 image imagination
The post is about the *pause*, not the spectacle. A phone or TV screen at night, **paused** mid-trailer on two backlit heroic silhouettes locking eyes — evoked, never legible (no real Marvel footage), just two dark shapes and a charged gap between them. The scrub/pause bar glows warm at the bottom; a deep-navy dark room around it. **Manual:** photograph your own screen paused on any abstract two-silhouette frame. **AI:** "two backlit hero silhouettes facing each other on a glowing paused video screen, deep navy dark room, warm progress bar, cinematic, no legible detail, no logos." Overlay 「你卡在哪一幀？」small. **Avoid:** actual Marvel trailer stills (rights), English.

---

## 6 · 正在燒 (burning now) · 206 ✓ · `item 9`

- **viral caption (in image):** 「這週末，你排場次了嗎？」
- **title:** 諾蘭封神的這個週末
- **full caption:**
《奧德賽（2026）》首週狂收2.64億美元的消息，一早滑臉書全是討論，生涯最強開片這種標題今天大概刷了滿版。

不過我在想的是，這年頭一部片能靠影廳撐出這種數字，某種程度也證明大螢幕還沒真的死透。串流再方便，該進場的人還是會進場，尤其是諾蘭這種名字。

只是有點好奇，這波熱潮之後，會不會又變成那種開片衝一波、口碑才是真正分水嶺的片。

你們這週末有排《奧德賽（2026）》的場次嗎，還是打算避開人潮晚點再看？

- **movie name（year）:** 奧德賽（2026）
- **director:** 克里斯多福·諾蘭
- **movie star:** —（票房報導，來源未列演員）
- **hashtags:** #奧德賽 #諾蘭 #電影票房 · **source:** Yahoo/FTNN 2026-07-20（首週 2.64 億）

### 🎨 image imagination
Show the wave as the *calm* underneath it. A quiet late-night cinema box-office / 售票 LED glowing warm in a near-empty lobby — one lit sign in the navy dark, no crowd (the "everyone's going" is implied, not shown). **Manual:** shoot a real cinema lobby / ticket counter at night on a phone. **AI:** "empty cinema lobby at night, one warm glowing box-office sign, deep navy shadows, soft blue ambient light, cinematic, quiet, no text, no people." Overlay 「這週末，你排場次了嗎？」small, lower third. **Avoid:** crowds, bright color, English signage.

---

## 7 · 正在燒 (burning now) · 211 ✓ · `item 10`

- **viral caption (in image):** 「今晚投給誰？」
- **title:** 這週末的新劇混戰
- **full caption:**
週末又多一部新劇殺進來，《毛骨悚然的戀愛（2026）》才播兩集，收視就衝到5.320%。朴恩斌這次從甜寵切成見鬼財閥千金，梁世宗演檢察官，兩人一邊查案一邊像在查彼此心裡的線索，導演是拍《為你心動（2023）》那位。其實這禮拜新劇多到誇張，《婚姻之後（2026）》、《公寓黑風暴（2026）》、《給你夢想（2026）》全擠同一個週末開播，觀眾根本分身乏術。比起場面，我更好奇這種驚悚加戀愛的配方能撐幾集不膩。你們今晚投給誰？

- **movie name（year）:** 毛骨悚然的戀愛（2026）
- **director:** 李旻樹
- **movie star:** 朴恩斌、梁世宗
- **hashtags:** #韓劇 #毛骨悚然的戀愛 #追劇 · **source:** Yahoo電影 2026-07-21（5大看點，首播 5.320%）

### 🎨 image imagination
The feeling is weekend choice-overload. A phone glowing in a dark room with a **streaming grid** of several drama tiles — indistinct glowing rectangles (no real poster art), one tile a touch brighter than the rest, as if you're hovering over it. Deep navy room, cool blue screen glow on the fingertips. **Manual:** photograph a streaming app open on your phone in a dark room, slightly out of focus. **AI:** "a phone in a dark room showing a glowing grid of blurred streaming thumbnails, one slightly brighter, cool blue screen light, deep navy, cinematic, no readable text." Overlay 「今晚投給誰？」. **Avoid:** real poster art (rights), English UI text.

---

## 8 · 正在燒 (burning now) · 177 ✓ · `item 11`

- **viral caption (in image):** 「未演，先轟動」
- **title:** 多倫多影展來的震撼彈
- **full caption:**
《幸福快樂的日子（2026）》入選多倫多影展特別放映單元的消息一出，時間軸整個炸了。舒華第一次演戲就直接跳國際影展，這個開局真的狠。第二波卡司也公布了，楊貴媚、高捷、陳璇、蔡凡熙全部到齊，陣容硬到不像新人磨合期。大家都在討論舒華會不會水土不服，但我比較好奇的是導演要怎麼調度這群老戲骨跟新人一起演。台灣電影這幾年很少見這種未演先轟動的氣勢，先閃，等預告。

- **movie name（year）:** 幸福快樂的日子（2026）
- **director:** 阮鳳儀（《美國女孩》金馬最佳新導演）
- **movie star:** 舒華（主演）、楊貴媚、高捷、陳璇、蔡凡熙
- **hashtags:** #多倫多影展 #幸福快樂的日子 #台灣電影 · **source:** Yahoo電影 2026-07-21（阮鳳儀新作入選 TIFF 特別放映、第二波卡司）

### 🎨 image imagination
Anticipation for something not yet seen. A single soft **spotlight beam** cutting through a dark space — or one empty premiere seat catching a warm pool of light — the "未演先轟動" hush before a premiere. Navy everywhere, one warm shaft of light. **Manual:** a spotlight/desk-lamp beam in a dark room, or an empty chair under a single light. **AI:** "a lone warm spotlight beam in a dark theatre, deep navy shadows, one empty seat catching the light, cinematic, quiet anticipation, no text, no faces." Overlay 「未演，先轟動」. **Avoid:** celebrity faces, festival logos, English (TIFF wordmark included).

---

## Appendix · why the trend path itself gave only 1

The three "clean" picks from this morning's trends — 復仇者聯盟：末日崛起, 功夫女足, 憨豆特工/Johnny English — were fed to M3 **from TMDB** and got **refused** ("only title + release date + poster; can't write without facts"). Only 少林足球 had a plot overview attached, so it produced draft #1. That's the RAZ-61 wall: trend keyword → TMDB is signal-thin. The rich drafts above (#2–#8) prove the fix is **material depth**, which the article-feed path supplies. Note the win: draft #5 (復仇者聯盟：末日崛起) *did* come through richly — because its **article** (自由娛樂's trailer story) carried real content, unlike its bare TMDB card. Same trend, the difference was the source.

**Also logged for whoever's fixing the webhook:** the automated trend→M2→M3 chain has a **page-id mismatch** — trend subscription page `jello_topmovie_svs` vs identity page `jello`. Fed raw, M3 skips "no identity." The article path writes `jello` directly, so it's unaffected; but the trend path needs those two ids reconciled to ever auto-draft.
