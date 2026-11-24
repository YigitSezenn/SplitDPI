# Güvenlik politikası

## Desteklenen sürümler

Güvenlik düzeltmeleri yalnızca [en son sürüme](https://github.com/YigitSezenn/SplitDPI/releases/latest) yayımlanır.

## Açık bildirme

Bir güvenlik açığı bulduysan lütfen herkese açık bir issue **açma**. Bunun yerine GitHub'ın özel bildirim özelliğini kullan:

**[Security → Report a vulnerability](https://github.com/YigitSezenn/SplitDPI/security/advisories/new)**

Bildirimine şunları eklemen işimi hızlandırır:

- Etkilenen sürüm ve Windows sürümü
- Açığın nasıl tetiklendiği (adım adım ya da örnek kod)
- Olası etkisi

Bildirimlere birkaç gün içinde dönüş yapmaya çalışıyorum. Açık doğrulandığında düzeltme yayımlanır ve istersen sürüm notlarında adın anılır.

## Kapsam

Şunlar kapsam içindedir:

- Yerel proxy'nin (`engine/`) başka bir süreç ya da web sayfası tarafından kötüye kullanılması
- Arayüzden ana sürece yetki yükseltme, keyfi kod çalıştırma
- Kurulum dosyası ve kaldırıcıyla ilgili sorunlar
- Kullanıcının ağ ayarlarını kalıcı olarak bozan durumlar

SplitDPI'ın belirli bir sağlayıcıda engeli aşamaması bir güvenlik açığı değildir. Bunun için normal bir [issue](https://github.com/YigitSezenn/SplitDPI/issues) açabilirsin.
