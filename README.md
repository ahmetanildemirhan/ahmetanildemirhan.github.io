# Ahmet Anıl Demirhan — Portfolyo

Kişisel portfolyo sitesi. Tek sayfa, ek kurulum gerektirmez.

- `index.html` — sitenin tamamı (metinler, tasarım, video listesi)
- `assets/ahmet.jpg` — profil fotoğrafı

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
