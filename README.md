# Ahmet Anıl Demirhan — Portfolyo

Kişisel portfolyo sitesi. Tek sayfa, ek kurulum gerektirmez.

- `index.html` — ana sayfa (metinler, video listesi, Türkçe çeviriler)
- `work/` — proje (vaka çalışması) sayfaları
- `assets/site.css`, `assets/site.js` — tüm sayfaların ortak tasarımı ve davranışı (tema, dil, video oynatıcı)
- `assets/ahmet.jpg` — profil fotoğrafı, `assets/og.png` — link paylaşım kartı
- `cv/cv.html` — CV kaynağı; `assets/Ahmet-Anil-Demirhan-CV.pdf` buradan üretilir
- `spotify/` — Spotify Zaman Makinesi: Spotify dinleme geçmişini tarayıcıda analiz eden sayfa (veri hiçbir yere yüklenmez)
  - `spotify/ahmet/` — kendi 13 yılımın hazır özeti; veriler `spotify/ahmet/data.json` içinde.
    Yenilemek için: `spotify/` sayfasına yeni ZIP'i yükle, tarayıcı konsolunda
    `copy(SpotifyApp.exportSummary())` çalıştır ve çıkanı `data.json` dosyasına yapıştır.
  - `app.js` / `app.css` değişince iki HTML dosyasındaki `?v=` numarasını da değiştir; yoksa tarayıcılar eski kodu yeni sayfayla karıştırabilir.
- `404.html`, `sitemap.xml`, `robots.txt` — bulunamayan sayfa ve arama motoru ayarları

## Video eklemek / çıkarmak

`index.html` içinde `const videos = [` satırını bul. Her satır bir videodur:

```js
["gd", "DRIVE_ID", "Video başlığı", "ie"],
["yt", "YOUTUBE_ID", "Video başlığı", "tr"],
```

- `gd` = Google Drive. ID, Drive linkindeki koddur (`drive.google.com/file/d/BURASI/view`).
  Dosya "linke sahip herkes görüntüleyebilir" olarak paylaşılmış olmalı.
- `yt` = YouTube. ID, linkteki koddur (`youtu.be/BURASI`). YouTube'dan kalkan videolar sitede otomatik gizlenir.
- Son alan kategoridir: `ads`, `ai`, `ie`, `motion`, `tr`.

## Yayında tutmak

Site GitHub Pages ile ücretsiz yayınlanır: Settings → Pages → Branch.
