# Ahmet Anıl Demirhan — Portfolyo

Kişisel portfolyo sitesi. Tek sayfa, ek kurulum gerektirmez.

- `index.html` — sitenin tamamı (metinler, tasarım, video listesi)
- `assets/ahmet.jpg` — profil fotoğrafı

## Video eklemek / çıkarmak

`index.html` içinde `const videos = [` satırını bul. Her satır bir videodur:

```js
["YOUTUBE_ID", "Video başlığı", "ie"],
```

`YOUTUBE_ID`, YouTube linkindeki koddur (`youtu.be/SREbl7Mpw2g` → `SREbl7Mpw2g`).
Son alan kategoridir: `ie` = Interesting Engineering, `tr` = Milliyet/Posta.

## Yayında tutmak

Site GitHub Pages ile ücretsiz yayınlanır: Settings → Pages → Branch.
