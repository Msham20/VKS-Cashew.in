const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const session = require('express-session');
const multer = require('multer');
const { connectToDatabase } = require('./db');

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

let db;
async function initDb() {
  db = await connectToDatabase();
}
initDb();

app.use(async (req, res, next) => {
  res.locals.isAdmin = !!req.session.isAdmin;
  const envWhatsapp = process.env.WHATSAPP_NUMBER;
  
  let settings;
  if (db) {
    settings = await db.collection('settings').findOne({}) || {};
  } else {
    settings = readSettings();
  }
  
  res.locals.settings = settings;
  res.locals.whatsappNumber =
    (settings && settings.whatsappNumber) || envWhatsapp || 'YOURNUMBER';
  next();
});

app.get('/', async (req, res) => {
  let products;
  if (db) {
    products = await db.collection('products').find().toArray();
  } else {
    products = readJson(PRODUCTS_FILE);
  }
  res.render('home', { products });
});

app.get('/products', async (req, res) => {
  let products;
  if (db) {
    products = await db.collection('products').find().toArray();
  } else {
    products = readJson(PRODUCTS_FILE);
  }
  const bulkOffers = products.filter((p) => p.isBulkOffer);
  res.render('products', { products, bulkOffers });
});

app.get('/about', (req, res) => {
  res.render('about');
});

app.get('/order', async (req, res) => {
  let products;
  if (db) {
    products = await db.collection('products').find().toArray();
  } else {
    products = readJson(PRODUCTS_FILE);
  }
  res.render('order', { products, error: null });
});

app.post('/order', async (req, res) => {
  const { customerName, phone, email, address, orderType } = req.body;
  let products;
  if (db) {
    products = await db.collection('products').find().toArray();
  } else {
    products = readJson(PRODUCTS_FILE);
  }

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

  if (db) {
    await db.collection('orders').insertOne(newOrder);
  } else {
    const orders = readJson(ORDERS_FILE);
    orders.push(newOrder);
    writeJson(ORDERS_FILE, orders);
  }

  let settings;
  if (db) {
    settings = await db.collection('settings').findOne({}) || {};
  } else {
    settings = readSettings();
  }
  
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

app.post('/track', async (req, res) => {
  const { orderId } = req.body;
  let order;
  if (db) {
    order = await db.collection('orders').findOne({ id: orderId.trim() });
  } else {
    const orders = readJson(ORDERS_FILE);
    order = orders.find((o) => o.id === orderId.trim());
  }
  res.render('track', {
    order: order || null,
    notFound: !order
  });
});

app.get('/invoice/:id', async (req, res) => {
  const { id } = req.params;
  let order, products, settings;
  
  if (db) {
    order = await db.collection('orders').findOne({ id: id });
    products = await db.collection('products').find().toArray();
    settings = await db.collection('settings').findOne({}) || {};
  } else {
    order = readJson(ORDERS_FILE).find((o) => o.id === id);
    products = readJson(PRODUCTS_FILE);
    settings = readSettings();
  }

  if (!order) {
    return res.status(404).send('Invoice not found');
  }
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

app.get('/admin', requireAdmin, async (req, res) => {
  let products, orders, settings;
  if (db) {
    products = await db.collection('products').find().toArray();
    orders = await db.collection('orders').find().toArray();
    settings = await db.collection('settings').findOne({}) || {};
  } else {
    products = readJson(PRODUCTS_FILE);
    orders = readJson(ORDERS_FILE);
    settings = readSettings();
  }
  
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

app.post('/admin/products/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, description, retailPricePerKg, wholesalePricePerKg, isBulkOffer } =
    req.body;
    
  if (db) {
    const update = {};
    if (name) update.name = name;
    if (description !== undefined) update.description = description;
    if (retailPricePerKg) update.retailPricePerKg = parseFloat(retailPricePerKg);
    if (wholesalePricePerKg) update.wholesalePricePerKg = parseFloat(wholesalePricePerKg);
    update.isBulkOffer = !!isBulkOffer;
    
    await db.collection('products').updateOne({ id: id }, { $set: update });
  } else {
    const products = readJson(PRODUCTS_FILE);
    const product = products.find((p) => p.id === id);
    if (product) {
      if (name) product.name = name;
      if (description !== undefined) product.description = description;
      product.retailPricePerKg = parseFloat(retailPricePerKg) || product.retailPricePerKg;
      product.wholesalePricePerKg = parseFloat(wholesalePricePerKg) || product.wholesalePricePerKg;
      product.isBulkOffer = !!isBulkOffer;
      writeJson(PRODUCTS_FILE, products);
    }
  }
  res.redirect('/admin');
});

app.post('/admin/settings/contact', requireAdmin, async (req, res) => {
  const { phone, email, address, whatsappNumber, shopName, gstin } = req.body;
  
  if (db) {
    const current = await db.collection('settings').findOne({}) || {};
    const updated = {
      ...current,
      shopName: shopName || current.shopName || 'Casheew Nuts & Dry Fruits',
      phone: phone || current.phone || '',
      email: email || current.email || '',
      address: address || current.address || '',
      whatsappNumber: whatsappNumber || current.whatsappNumber || '',
      gstin: gstin || current.gstin || ''
    };
    await db.collection('settings').replaceOne({}, updated, { upsert: true });
  } else {
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
  }
  res.redirect('/admin');
});

app.post(
  '/admin/settings/payment-qr',
  requireAdmin,
  upload.single('qrImage'),
  async (req, res) => {
    if (!req.file) {
      return res.redirect('/admin');
    }
    
    if (db) {
      const current = await db.collection('settings').findOne({}) || {};
      const updated = {
        ...current,
        paymentQrImage: '/uploads/' + req.file.filename,
        paymentNote: req.body.paymentNote || current.paymentNote || ''
      };
      await db.collection('settings').replaceOne({}, updated, { upsert: true });
    } else {
      const current = readSettings();
      const updated = {
        ...current,
        paymentQrImage: '/uploads/' + req.file.filename,
        paymentNote: req.body.paymentNote || current.paymentNote || ''
      };
      writeJson(SETTINGS_FILE, updated);
    }
    res.redirect('/admin');
  }
);

app.post(
  '/admin/products/new',
  requireAdmin,
  upload.single('image'),
  async (req, res) => {
    const { name, description, retailPricePerKg, wholesalePricePerKg, isBulkOffer } =
      req.body;
    if (!name) {
      return res.redirect('/admin');
    }
    
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

    if (db) {
      await db.collection('products').insertOne(newProduct);
    } else {
      const products = readJson(PRODUCTS_FILE);
      products.push(newProduct);
      writeJson(PRODUCTS_FILE, products);
    }
    res.redirect('/admin');
  }
);

app.post(
  '/admin/products/:id/image',
  requireAdmin,
  upload.single('image'),
  async (req, res) => {
    const { id } = req.params;
    if (!req.file) {
      return res.redirect('/admin');
    }
    
    if (db) {
      await db.collection('products').updateOne(
        { id: id },
        { $set: { image: '/uploads/' + req.file.filename } }
      );
    } else {
      const products = readJson(PRODUCTS_FILE);
      const product = products.find((p) => p.id === id);
      if (product) {
        product.image = '/uploads/' + req.file.filename;
        writeJson(PRODUCTS_FILE, products);
      }
    }
    res.redirect('/admin');
  }
);

app.post('/admin/orders/:id/status', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (db) {
    await db.collection('orders').updateOne({ id: id }, { $set: { status: status } });
  } else {
    const orders = readJson(ORDERS_FILE);
    const order = orders.find((o) => o.id === id);
    if (order) {
      order.status = status;
      writeJson(ORDERS_FILE, orders);
    }
  }
  res.redirect('/admin');
});

app.get('/admin/orders/daily.csv', requireAdmin, async (req, res) => {
  const dateParam = req.query.date;
  let orders;
  if (db) {
    orders = await db.collection('orders').find().toArray();
  } else {
    orders = readJson(ORDERS_FILE);
  }
  
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
