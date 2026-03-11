const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const session = require('express-session');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Use process.cwd() to correctly locate folders in Vercel serverless environment
const DATA_DIR = path.join(process.cwd(), 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'casheew123';

const storage = multer.memoryStorage();

const upload = multer({ storage });

function ensureDataFiles() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    if (!fs.existsSync(PRODUCTS_FILE)) {
      const initialProducts = [
        {
          id: 'P001',
          name: 'Whole Cashew (W320)',
          description: 'Premium whole cashew nuts, perfect for snacking.',
          image: '/images/cashew-hero.png',
          retailPricePerKg: 900,
          wholesalePricePerKg: 820,
          isBulkOffer: false
        },
        {
          id: 'P002',
          name: 'Roasted Salted Cashew',
          description: 'Crispy roasted cashews with light salt.',
          image: '/images/cashew-hero.png',
          retailPricePerKg: 950,
          wholesalePricePerKg: 870,
          isBulkOffer: true
        },
        {
          id: 'P003',
          name: 'Spicy Masala Cashew',
          description: 'Hot and spicy masala coated cashews.',
          image: '/images/cashew-hero.png',
          retailPricePerKg: 980,
          wholesalePricePerKg: 900,
          isBulkOffer: true
        }
      ];
      fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(initialProducts, null, 2));
    }
    if (!fs.existsSync(ORDERS_FILE)) {
      fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(SETTINGS_FILE)) {
      const defaultSettings = {
        shopName: 'Casheew Nuts & Dry Fruits',
        phone: '+91 98765 43210',
        email: 'support@casheew.in',
        address: 'Chennai, India',
        whatsappNumber: '919876543210',
        gstin: '33ABCDE1234F1Z5',
        paymentQrImage: '',
        paymentNote: ''
      };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
    }
  } catch (err) {
    console.warn('Warning: Could not ensure data files (likely read-only filesystem):', err.message);
  }
}

function readJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content || '[]');
  } catch (err) {
    return [];
  }
}

function readSettings() {
  try {
    const content = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(content || '{}');
    return {
      paymentQrImage: '',
      paymentNote: '',
      ...parsed
    };
  } catch (err) {
    return {};
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error writing to ${filePath}:`, err.message);
  }
}

function generateOrderId() {
  const now = new Date();
  return (
    'CSH' +
    now.getFullYear().toString().slice(-2) +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0') +
    '-' +
    Math.floor(1000 + Math.random() * 9000)
  );
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

ensureDataFiles();

app.set('view engine', 'ejs');
app.set('views', [
  path.join(process.cwd(), 'views'),
  path.join(__dirname, '..', 'views')
]);

app.use(express.static(path.join(process.cwd(), 'public')));
app.use(bodyParser.urlencoded({ extended: false }));

app.use(
  session({
    secret: 'casheew-secret-key',
    resave: false,
    saveUninitialized: false
  })
);

app.use((req, res, next) => {
  res.locals.isAdmin = !!req.session.isAdmin;
  const envWhatsapp = process.env.WHATSAPP_NUMBER;
  const settings = readSettings();
  res.locals.settings = settings;
  res.locals.whatsappNumber =
    (settings && settings.whatsappNumber) || envWhatsapp || 'YOURNUMBER';
  next();
});

app.get('/', (req, res) => {
  const products = readJson(PRODUCTS_FILE);
  res.render('home', { products });
});

app.get('/products', (req, res) => {
  const products = readJson(PRODUCTS_FILE);
  const bulkOffers = products.filter((p) => p.isBulkOffer);
  res.render('products', { products, bulkOffers });
});

app.get('/about', (req, res) => {
  res.render('about');
});

app.get('/order', (req, res) => {
  const products = readJson(PRODUCTS_FILE);
  res.render('order', { products, error: null });
});

app.post('/order', (req, res) => {
  const { customerName, phone, email, address, orderType } = req.body;
  const products = readJson(PRODUCTS_FILE);

  const items = products
    .map((p) => {
      const qty = parseFloat(req.body[`qty_${p.id}`]);
      if (!qty || qty <= 0) return null;
      return { productId: p.id, name: p.name, quantityKg: qty };
    })
    .filter(Boolean);

  const totalKg = items.reduce((sum, item) => sum + item.quantityKg, 0);

  if (!items.length) {
    return res.render('order', {
      products,
      error: 'Please select at least one product with quantity.',
    });
  }

  if (orderType === 'wholesale' && totalKg < 5) {
    return res.render('order', {
      products,
      error: 'Minimum bulk (wholesale) order is 5 kg in total.',
    });
  }

  let totalPrice = 0;
  items.forEach((item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return;
    const pricePerKg =
      orderType === 'wholesale'
        ? product.wholesalePricePerKg
        : product.retailPricePerKg;
    totalPrice += pricePerKg * item.quantityKg;
  });

  const orders = readJson(ORDERS_FILE);
  const newOrder = {
    id: generateOrderId(),
    customerName,
    phone,
    email,
    address,
    orderType,
    items,
    totalKg,
    totalPrice,
    status: 'Pending',
    createdAt: new Date().toISOString()
  };
  orders.push(newOrder);
  writeJson(ORDERS_FILE, orders);

  const settings = readSettings();
  const envWhatsapp = process.env.WHATSAPP_NUMBER;
  const whatsappNumber =
    (settings && settings.whatsappNumber) || envWhatsapp || 'YOURNUMBER';
  const orderSummaryLines = items
    .map((i) => `${i.name} - ${i.quantityKg} kg`)
    .join('%0A');
  const message = encodeURIComponent(
    `Hi, I placed an order on Casheew website.%0AOrder ID: ${newOrder.id}%0AName: ${customerName}%0APhone: ${phone}%0AType: ${orderType}%0AItems:%0A${orderSummaryLines}`
  );
  const whatsappLink = `https://wa.me/${whatsappNumber}?text=${message}`;

  res.render('order-success', {
    order: newOrder,
    whatsappLink
  });
});

app.get('/track', (req, res) => {
  res.render('track', { order: null, notFound: false });
});

app.post('/track', (req, res) => {
  const { orderId } = req.body;
  const orders = readJson(ORDERS_FILE);
  const order = orders.find((o) => o.id === orderId.trim());
  res.render('track', {
    order: order || null,
    notFound: !order
  });
});

app.get('/invoice/:id', (req, res) => {
  const { id } = req.params;
  const orders = readJson(ORDERS_FILE);
  const products = readJson(PRODUCTS_FILE);
  const order = orders.find((o) => o.id === id);
  if (!order) {
    return res.status(404).send('Invoice not found');
  }
  const settings = readSettings();
  res.render('invoice', { order, products, settings });
});

app.get('/admin/login', (req, res) => {
  res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin-login', { error: 'Invalid admin password.' });
});

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect('/admin/login');
  }
  next();
}

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

app.get('/admin', requireAdmin, (req, res) => {
  const products = readJson(PRODUCTS_FILE);
  const orders = readJson(ORDERS_FILE);
  const settings = readSettings();
  const today = formatDate(new Date());
  const todaysOrders = orders.filter(
    (o) => formatDate(new Date(o.createdAt)) === today
  );
  res.render('admin-dashboard', {
    products,
    orders,
    todaysOrders,
    today,
    settings
  });
});

app.post('/admin/products/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, description, retailPricePerKg, wholesalePricePerKg, isBulkOffer } =
    req.body;
  const products = readJson(PRODUCTS_FILE);
  const product = products.find((p) => p.id === id);
  if (product) {
    if (name) {
      product.name = name;
    }
    if (description !== undefined) {
      product.description = description;
    }
    product.retailPricePerKg = parseFloat(retailPricePerKg) || product.retailPricePerKg;
    product.wholesalePricePerKg = parseFloat(wholesalePricePerKg) || product.wholesalePricePerKg;
    product.isBulkOffer = !!isBulkOffer;
    writeJson(PRODUCTS_FILE, products);
  }
  res.redirect('/admin');
});

app.post('/admin/settings/contact', requireAdmin, (req, res) => {
  const { phone, email, address, whatsappNumber, shopName, gstin } = req.body;
  const current = readSettings();
  const updated = {
    ...current,
    shopName: shopName || current.shopName || 'Casheew Nuts & Dry Fruits',
    phone: phone || current.phone || '',
    email: email || current.email || '',
    address: address || current.address || '',
    whatsappNumber: whatsappNumber || current.whatsappNumber || '',
    gstin: gstin || current.gstin || ''
  };
  writeJson(SETTINGS_FILE, updated);
  res.redirect('/admin');
});

app.post(
  '/admin/settings/payment-qr',
  requireAdmin,
  upload.single('qrImage'),
  (req, res) => {
    if (!req.file) {
      return res.redirect('/admin');
    }
    const current = readSettings();
    const updated = {
      ...current,
      paymentQrImage: '/uploads/' + req.file.filename,
      paymentNote: req.body.paymentNote || current.paymentNote || ''
    };
    writeJson(SETTINGS_FILE, updated);
    res.redirect('/admin');
  }
);

app.post(
  '/admin/products/new',
  requireAdmin,
  upload.single('image'),
  (req, res) => {
    const { name, description, retailPricePerKg, wholesalePricePerKg, isBulkOffer } =
      req.body;
    if (!name) {
      return res.redirect('/admin');
    }
    const products = readJson(PRODUCTS_FILE);
    const id = 'P' + (Date.now().toString().slice(-6));
    let imagePath = '/images/cashew-hero.png';
    if (req.file) {
      imagePath = '/uploads/' + req.file.filename;
    }
    const newProduct = {
      id,
      name,
      description: description || '',
      image: imagePath,
      retailPricePerKg: parseFloat(retailPricePerKg) || 0,
      wholesalePricePerKg: parseFloat(wholesalePricePerKg) || 0,
      isBulkOffer: !!isBulkOffer
    };
    products.push(newProduct);
    writeJson(PRODUCTS_FILE, products);
    res.redirect('/admin');
  }
);

app.post(
  '/admin/products/:id/image',
  requireAdmin,
  upload.single('image'),
  (req, res) => {
    const { id } = req.params;
    if (!req.file) {
      return res.redirect('/admin');
    }
    const products = readJson(PRODUCTS_FILE);
    const product = products.find((p) => p.id === id);
    if (product) {
      product.image = '/uploads/' + req.file.filename;
      writeJson(PRODUCTS_FILE, products);
    }
    res.redirect('/admin');
  }
);

app.post('/admin/orders/:id/status', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const orders = readJson(ORDERS_FILE);
  const order = orders.find((o) => o.id === id);
  if (order) {
    order.status = status;
    writeJson(ORDERS_FILE, orders);
  }
  res.redirect('/admin');
});

app.get('/admin/orders/daily.csv', requireAdmin, (req, res) => {
  const dateParam = req.query.date;
  const orders = readJson(ORDERS_FILE);
  const targetDate = dateParam || formatDate(new Date());
  const filtered = orders.filter(
    (o) => formatDate(new Date(o.createdAt)) === targetDate
  );

  const header =
    'Order ID,Customer Name,Phone,Order Type,Total Kg,Total Price,Status,Created At,Items';
  const rows = filtered.map((o) => {
    const itemsText = o.items
      .map((i) => `${i.name} (${i.quantityKg} kg)`)
      .join(' | ');
    return `"${o.id}","${o.customerName}","${o.phone}","${o.orderType}",` +
      `${o.totalKg},${o.totalPrice},"${o.status}","${o.createdAt}","${itemsText}"`;
  });

  const csv = [header, ...rows].join('\n');
  res.header('Content-Type', 'text/csv');
  res.attachment(`casheew-orders-${targetDate}.csv`);
  res.send(csv);
});

app.use((req, res) => {
  res.status(404).render('404');
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Casheew website running on http://localhost:${PORT}`);
  });
}

module.exports = app;
