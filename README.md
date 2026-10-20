https://cift-yarik.vercel.app/
# Çift Yarık — Etkileşimli Fizik Laboratuvarı

Tek fotonlardan Fresnel alanına, hangi-yol bilgisinden madde dalgalarına kadar çift yarık
deneyini beş ayrı etkileşimli düzenekte inceleyen, bağımlılıksız bir tarayıcı uygulaması.

Arayüz ve bütün açıklamalar Türkçedir. Uygulama; HTML, CSS ve klasik JavaScript dosyalarından
oluşur; derleme adımı, paket yöneticisi veya harici kütüphane gerektirmez.

## Çalıştırma

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Ardından tarayıcıda `http://127.0.0.1:8765/` adresini açın. `index.html` doğrudan
dosya olarak da açılabilir; ancak yerel sunucu, testler ve olası tarayıcı kısıtlamaları
için daha güvenilirdir.

Fizik çekirdeğinin doğrulama sayfası: `http://127.0.0.1:8765/tests.html`

## Modlar

| Mod | Ne gösterir? | Öne çıkan etkileşim |
| --- | --- | --- |
| **01 · Fotonlar** | Tek fotonların ekrana tek tek düşüp binlerce olayda `|ψ|²` desenini oluşturması | Ateşleme, otomatik akış, hız, N yarık sayısı, görünürlük `V` |
| **02 · Dalga Alanı** | Yarıktan ekrana kadar yakın-alan Fresnel kırınım haritası | Ekran çizgisini sürükleme, `z` konumu, Fresnel/Fraunhofer geçişi |
| **03 · Hangi Yol?** | Yol işaretçileriyle görünürlük–yol bilgisi tamamlayıcılığı ve quantum eraser | İşaretçi açısı `θ`, analizör, `V² + D² = 1` |
| **04 · Madde** | Elektron, nötron, proton ve C₆₀ için de Broglie dalgaları | Parçacık türü, kinetik enerji, yarık aralığı, ekran uzaklığı |
| **05 · Teori** | 11 bölümlük makale: tarih, matematik, yanlış anlamalar, deneyler | İçindekiler bağlantıları, formüller, şemalar |

### Fotonlar

- Varsayılan düzenek: `λ = 532 nm`, `d = 0.25 mm`, `a = 0.060 mm`, `L = 1.20 m`.
- Tek foton konumları, ekran üzerindeki `|ψ|²` dağılımından ters-CDF Monte Carlo ile örneklenir.
- `N = 1` seçildiğinde tek yarık kırınımına geçilir; saçak istatistikleri buna göre değişir.
- `V = 0` tamamen incoherent, `V = 1` tamamen coherent iki yarık kaynağına karşılık gelir.
- Ekrana tıklamak bir olay üretir; `Boşluk` tuşu da aynı işi yapar.

### Dalga Alanı

- `z = 0.8 mm … 200 mm` aralığında Fresnel kırınım integrali hesaplanır.
- Harita, her `z` sütunu için ayrı normalize edilir; böylece hem çok yakın alan hem de
  Fraunhofer bölgesi aynı görsel ölçekte okunabilir.
- Ekran çizgisi fareyle sürüklenebilir; sağdaki profil ve veri kartı anlık güncellenir.
- `F = a² / (λz)` değeri veri panelinde gösterilir. `F ≳ 1` yakın alan, `F ≪ 1`
  Fraunhofer bölgesi olarak işaretlenir.

### Hangi Yol?

İdealize edilmiş bir işaretçi modeli kullanılır:

- İki yol, `+θ` ve `−θ` yönünde doğrusal işaretçilerle etiketlenir.
- İşaretçisiz görünürlük: `V = |cos 2θ|`
- Yol bilgisi: `D = |sin 2θ|`
- Tamamlayıcılık: `V² + D² = 1`
- Analizör, işaretçilerin ortak bileşenini seçer. Seçilen alt kümede girişim geri gelir
  (`V = 1`), fakat geçen foton oranı `cos²θ` olur.
- `θ = 45°` tam yol bilgisi, `θ = 0°` tam girişim durumudur.

### Madde

- Relativistik de Broglie bağıntısı kullanılır:
  `λ = h / p = hc / √[K(K + 2mc²)]`
- Parçacık türleri: elektron, nötron, proton, C₆₀.
- Kinetik enerji logaritmik kaydırıcıyla değiştirilir; `γ`, `β = v/c`, momentum ve
  relativistik düzeltme durumu canlı gösterilir.
- Gerçek saçak aralıkları çok küçük olduğu için ekran görünümü büyütülür; veri kartında
  gerçek `Δy` ve yarık ölçeği ayrıca belirtilir.

## Fizik modeli

### Uzak alan (Fraunhofer)

Sonlu yarık zarfı ile `N` yarıklı girişim terimi çarpılır:

```
I(y) ∝ sinc²(β) · [ (1 − V)/N + V · (sin Nα / N sin α)² ]

β = π a sin θ / λ
α = π d sin θ / λ
sin θ = y / √(y² + L²)
```

`sinc(x) = sin(x)/x` biçimindedir. `N = 1` için ifade yalnızca `sinc²(β)` zarfına indirgenir.

### Tek foton örnekleme

Ekran aralığı `2048` kutuya bölünür, her kutudaki şiddet `|ψ|²` olarak alınır ve normalize
kümülatif dağılım (CDF) oluşturulur. Her foton için tekdüze bir `u ∈ [0,1)` üretilip CDF
üzerinde ikili arama ile ters dönüşüm yapılır. Bu, tek fotonların istatistiksel olarak doğru
dağılmasını sağlar.

### Yakın alan (Fresnel)

Aralıklı düzlemde skaler Fresnel integrali:

```
U(x, z) ∝ ∫ exp[iπ (x′ − x)² / (λz)] dx′
```

İntegral, Fresnel `C` ve `S` fonksiyonlarına dönüştürülür:

```
C(v) + iS(v) = ∫₀ᵛ exp(iπt²/2) dt
```

Uygulamada `C` ve `S`, küçük argümanlar için kuvvet serisi ve tablo enterpolasyonu;
büyük argümanlar için asimptotik açılımla hesaplanır. Yarıklar düşey yönde uzun kabul
edildiğinden harita, tek boyutlu bir Fresnel kırınımıdır.

### Renk

Foton rengi, dalga boyundan yaklaşık bir HSL eşlemesiyle üretilir. Bu eğitim amaçlı bir
görselleştirmedir; fotometrik veya spektral olarak kalibre edilmiş bir renk uzayı değildir.

## Varsayımlar ve sınırlar

- Skaler, paraksiyal ve tek renkli dalga optiği kullanılır.
- Yarıklar ideal, sonsuz ince ve düşey yönde uzundur; kenar etkileri ve sonlu kalınlık yoktur.
- Dedektörler ideal kabul edilir: karanlık sayım, okuma gürültüsü, ölü zaman ve kuantum
  verimliliği modellenmez.
- Fresnel haritası her `z` sütununda ayrı normalize edilir. Bu nedenle haritanın parlaklığı
  `z` boyunca mutlak şiddet değil, göreli desen olarak okunmalıdır.
- Ekran, görüş alanı dışındaki kuyrukları keser; çok küçük şiddetli kenar saçakları
  örnekleme dışında kalabilir.
- Hangi Yol? modülü tam bir polarizasyon/Stokes hesabı değil, iki durumlu ideal işaretçi
  modelidir. Analizör idealdir; dedektör verimliliği ve hizalama hataları yoktur.
- Tek parçacık olayları bağımsızdır. Çok fotonlu girişim, tesadüf sayımları ve entanglement
  temelli gecikmeli seçim (delayed-choice) deneyleri modellenmez.
- `V` kaydırıcısı, kısmi coherence için fenomenolojik bir görünürlük parametresidir; kaynağın
  sonlu boyutu veya spektral genişliği ayrıca hesaplanmaz.
- Madde modunda ekran ölçeği okunabilirlik için büyütülür; gerçek uzunluklar veri kartında
  ayrıca verilir.

## Doğrulama

`tests.html`, fizik çekirdeğini tarayıcıda çalıştırır. Son çalıştırmada **13/13 test** geçti:

1. Fresnel `C(1)`, `S(1)` referans değerleri
2. Fresnel `C(2)`, `S(2)` referans değerleri
3. Fresnel `C(10)`, `S(10)` asimptotik davranışı
4. Fresnel fonksiyonlarının tek/çift simetrisi
5. Uzak alanda Fresnel integralinin Fraunhofer ifadesine yakınsaması
6. Yapıcı ve yıkıcı saçak konumlarının doğruluğu
7. Tek yarık sıfırının `sin θ = λ/a` ile uyumu
8. `V = 0` durumunda merkez şiddetinin `1/N` olması
9. Örnekleyici CDF'sinin sınırları ve dağılım ortalaması
10. 100 eV elektronun de Broglie dalga boyu
11. Termal nötronun de Broglie dalga boyu
12. 100 eV C₆₀'ın de Broglie dalga boyu
13. Ekran genişliğinin `d` ile doğru ölçeklenmesi

## Dosya yapısı

```
index.html          uygulama kabuğu, modlar, kontroller ve teori makalesi
css/styles.css      görsel sistem, yerleşim ve duyarlı tasarım
js/physics.js       Fresnel, girişim, örnekleme, de Broglie, biçimlendirme
js/app.js           çizim, etkileşim, mod mantığı, Monte Carlo ve Fresnel işi
tests.html          13 maddelik fizik doğrulama sayfası
favicon.svg         uygulama simgesi
README.md           bu dosya
```

## Kısayollar

- `1`–`5`: modlar arasında geçiş
- `Boşluk`: Fotonlar/Madde modunda bir olay üret
- `R`: Fotonlar/Madde modunda birikimi sıfırla
- Dalga Alanı: ekran çizgisini sürükleyerek `z` değiştir
- Fotonlar/Madde: sahneye tıklayarak tek olay üret
