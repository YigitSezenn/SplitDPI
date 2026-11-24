# Değişiklik günlüğü

## 1.3.0

- **Gizlilik:** Ana ekrandaki akış animasyonu artık gerçek site adlarını göstermiyor; SNI alanı maskelenmiş olarak çiziliyor. Ekran paylaşırken ziyaret ettiğin siteler görünmez.
- Arka plan servisi son bağlanılan siteleri artık diske yazmıyor.
- İlk açılışta kısa bir tanıtım ekranı.
- Ana ekran metinleri sadeleştirildi: **Bağlı** / **Bağlı değil**.
- Düzeltme: Bağlantı kesildiğinde önceki oturumun istatistikleri ekranda kalıyordu.

## 1.2.2

- DNS kaydı olmayan adresler (ör. `*.dc-telemetry.net` ölçüm adresleri) artık uyarı olarak değil, bilgi satırı olarak gösteriliyor.

## 1.2.1

Güvenlik düzeltmeleri (Claude Security taramasıyla bulundu):

- **Orta:** Şifresiz HTTP isteklerinde proxy hedef sunucuyu yalnızca bağlantıdaki ilk istekten seçiyordu. Aynı bağlantıdan gelen sonraki istekler başka bir siteye ait olsa bile ilk sunucuya aktarılabiliyordu. Artık bağlantı başına tek istek işleniyor ve sunucuya `Connection: close` gönderiliyor.
- **Düşük:** Proxy, yerel ve özel ağ adreslerine çözülen alan adlarına bağlanabiliyordu (DNS rebinding). Artık bu adresler 403 ile reddediliyor; denetim bağlanılan adresin kendisine uygulanıyor. Sistem proxy istisnalarına tüm özel ağ aralıkları eklendi.
- Her iki açık için regresyon testleri eklendi.

## 1.2.0

- Uygulamanın adı **SplitDPI** oldu. Önceki adla (Geçit) kurulmuş sürüm otomatik kaldırılır, ayarlar taşınır.
- Yeni ana ekran: paketlerin DPI'dan nasıl geçtiğini gerçek bağlantı adlarıyla gösteren akış animasyonu.
- **Arka plan servisi:** penceresiz ve tepsisiz çalışma, Windows açılışında otomatik başlama.
- **Tüm siteler** seçeneği varsayılan oldu. Discord, Roblox ve Wattpad için hazır listeler eklendi.
- Canlı trafik grafiği, oturum süresi, kayıt filtreleri.
- Güvenlik: Electron 45, fuse'larla sertleştirilmiş paket, ayar doğrulama, DNS rebinding koruması, bağlantı ve kaynak sınırları, beklenmedik kapanmadan sonra proxy ayarının otomatik düzeltilmesi.

## 1.1.0

- Hazır site listeleri, başlangıç seçenekleri, yeni arayüz.

## 1.0.0

- İlk sürüm: TLS kaydı bölme, TCP parçalama, DNS-over-HTTPS, sistem proxy'si, Discord başlatıcı.
