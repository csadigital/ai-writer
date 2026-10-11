# AI Writer ✨

**Ürün görsellerini, mağazana uygun çok dilli açıklamalara dönüştür.**

[English README](README.md) · [Kurulum ve dağıtım](docs/DEPLOYMENT.md)

## Neler yapar?

- Bir ila sekiz ürün görselinden açıklama taslağı üretir.
- Herkese açık HTTPS ürün sayfalarından görsel bağlantılarını toplar.
- Türkçe, İngilizce, İspanyolca, Almanca, Fransızca ve Çince çıktı sunar.
- Taslağı düzenlemeyi, kopyalamayı ve başka bir dile çevirmeyi sağlar.
- Kullanıcı hesabını ve kredi bakiyesini MySQL’de tutar; başarısız üretimde krediyi iade eder.
- Kısa YouTube videolarından karelerle açıklama üretmeyi deneysel olarak destekler.

![AI Writer arayüzü](docs/studio.png)

## Hızlı kurulum

Node.js 22.12+, OpenAI API anahtarı ve Docker Compose veya mevcut MySQL 8+ sunucusu gerekir. Görsel toplamak için Puppeteer’ın Chrome kurulumu, video için FFmpeg ve FFprobe gerekir.

```bash
git clone https://github.com/csadigital/ai-writer.git
cd ai-writer
npm run setup
npm start
```

Kurulum sihirbazı bağımlılıkları ve Chrome’u yükler, API anahtarını ekranda göstermeden sorar, `.env` dosyasını ve oturum anahtarını oluşturur. **docker** seçeneği MySQL sunucusunu otomatik başlatır; **existing** mevcut sunucunu kullanır. Mevcut sunucuda yönetici bilgileriyle uygulama veritabanını ve kullanıcısını oluşturabilir. Yönetici parolası kaydedilmez. Eski `.env` değerleri korunur ve yerel yedeği alınır.

Docker seçeneği için Docker’ın kurulu ve çalışır olması gerekir. Mevcut Docker veritabanının parolasını `.env` üzerinden değiştirmek, veri volume’ündeki kullanıcıyı değiştirmez. Veriler korunur; parolaları değiştireceksen ayrıca veritabanında güncelle.

Manuel kurulum adımları [English README](README.md#manual-setup) içinde bulunur.

**http://localhost:3000** adresinden hesap oluşturup giriş yap. Yeni hesaplar 10 kredi alır. Başarılı açıklama veya çeviri 1 kredi kullanır. Ödeme/kredi satın alma sistemi bulunmaz.

## Kontroller

```bash
npm run check
npm test
```

Testler gerçek API anahtarı veya veritabanı kullanmaz. Canlı OpenAI, MySQL ve YouTube doğrulaması ayrıca yapılmalıdır. Video akışı deneysel olup YouTube tarafındaki değişikliklerden etkilenebilir.

Üretilen taslakları yayınlamadan önce kontrol et. Kumaş, ölçü ve sertifika gibi bilgiler görsellerden kesin olarak belirlenemez.

Public depo, kaynak kodunun herkese açılmasıdır. Canlı uygulama için ayrıca sunucu, HTTPS ve [dağıtım yapılandırması](docs/DEPLOYMENT.md) gerekir.

## Lisans

[ISC](LICENSE).
