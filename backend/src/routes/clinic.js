const express = require('express');
const router = express.Router();
const { authenticate, attachBusinessId } = require('../middleware/auth');
const prisma = require('../config/prisma');

router.use(authenticate, attachBusinessId);

// ─── Services ─────────────────────────────────────────────────────────────────

router.get('/services', async (req, res) => {
  try {
    const services = await prisma.service.findMany({
      where: { business_id: req.businessId },
      orderBy: { name_ar: 'asc' },
    });
    res.json({ services });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/services', async (req, res) => {
  try {
    const { name_ar, name_en, duration_minutes, price } = req.body;
    if (!name_ar) return res.status(400).json({ error: 'name_ar is required' });

    const service = await prisma.service.create({
      data: {
        business_id: req.businessId,
        name_ar,
        name_en: name_en || null,
        duration_minutes: duration_minutes ? parseInt(duration_minutes) : 30,
        price: price != null ? parseFloat(price) : null,
      },
    });
    res.status(201).json({ service });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/services/:id', async (req, res) => {
  try {
    const existing = await prisma.service.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.status(404).json({ error: 'Service not found' });

    const { name_ar, name_en, duration_minutes, price, active } = req.body;
    const data = {};
    if (name_ar !== undefined) data.name_ar = name_ar;
    if (name_en !== undefined) data.name_en = name_en;
    if (duration_minutes !== undefined) data.duration_minutes = parseInt(duration_minutes);
    if (price !== undefined) data.price = price != null ? parseFloat(price) : null;
    if (active !== undefined) data.active = active;

    const service = await prisma.service.update({ where: { id: req.params.id }, data });
    res.json({ service });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/services/:id', async (req, res) => {
  try {
    const existing = await prisma.service.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.json({ success: true });
    await prisma.service.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Doctors ──────────────────────────────────────────────────────────────────

router.get('/doctors', async (req, res) => {
  try {
    const doctors = await prisma.doctor.findMany({
      where: { business_id: req.businessId },
      include: {
        doctorServices: { include: { service: { select: { id: true, name_ar: true } } } },
      },
      orderBy: { name_ar: 'asc' },
    });
    res.json({ doctors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/doctors', async (req, res) => {
  try {
    const { name_ar, name_en, specialty_ar } = req.body;
    if (!name_ar) return res.status(400).json({ error: 'name_ar is required' });

    const doctor = await prisma.doctor.create({
      data: {
        business_id: req.businessId,
        name_ar,
        name_en: name_en || null,
        specialty_ar: specialty_ar || null,
      },
    });
    res.status(201).json({ doctor });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/doctors/:id', async (req, res) => {
  try {
    const existing = await prisma.doctor.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.status(404).json({ error: 'Doctor not found' });

    const { name_ar, name_en, specialty_ar, active } = req.body;
    const data = {};
    if (name_ar !== undefined) data.name_ar = name_ar;
    if (name_en !== undefined) data.name_en = name_en;
    if (specialty_ar !== undefined) data.specialty_ar = specialty_ar;
    if (active !== undefined) data.active = active;

    const doctor = await prisma.doctor.update({ where: { id: req.params.id }, data });
    res.json({ doctor });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/doctors/:id', async (req, res) => {
  try {
    const existing = await prisma.doctor.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.json({ success: true });
    await prisma.doctor.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clinic/doctors/:id/services — assign services to doctor
router.post('/doctors/:id/services', async (req, res) => {
  try {
    const doctor = await prisma.doctor.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!doctor) return res.status(404).json({ error: 'Doctor not found' });

    const { service_ids } = req.body;
    if (!Array.isArray(service_ids)) return res.status(400).json({ error: 'service_ids must be an array' });

    // Verify all services belong to this business
    const services = await prisma.service.findMany({
      where: { id: { in: service_ids }, business_id: req.businessId },
    });
    if (services.length !== service_ids.length) {
      return res.status(400).json({ error: 'One or more service_ids are invalid' });
    }

    // Replace existing assignments
    await prisma.$transaction([
      prisma.doctorService.deleteMany({ where: { doctor_id: req.params.id } }),
      prisma.doctorService.createMany({
        data: service_ids.map(sid => ({ doctor_id: req.params.id, service_id: sid })),
        skipDuplicates: true,
      }),
    ]);

    const updated = await prisma.doctor.findUnique({
      where: { id: req.params.id },
      include: {
        doctorServices: { include: { service: { select: { id: true, name_ar: true } } } },
      },
    });
    res.json({ doctor: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Appointment Slots ────────────────────────────────────────────────────────

router.get('/slots', async (req, res) => {
  try {
    const { doctor_id, service_id, date_from, date_to, available } = req.query;
    const where = { business_id: req.businessId };
    if (doctor_id) where.doctor_id = doctor_id;
    if (service_id) where.service_id = service_id;
    if (available === 'true') where.is_booked = false;
    if (available === 'false') where.is_booked = true;
    if (date_from || date_to) {
      where.start_time = {};
      if (date_from) where.start_time.gte = new Date(date_from);
      if (date_to) where.start_time.lte = new Date(date_to);
    }

    const slots = await prisma.appointmentSlot.findMany({
      where,
      include: {
        doctor: { select: { id: true, name_ar: true } },
        service: { select: { id: true, name_ar: true, duration_minutes: true } },
      },
      orderBy: { start_time: 'asc' },
    });
    res.json({ slots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/slots', async (req, res) => {
  try {
    const { doctor_id, service_id, start_time, end_time } = req.body;
    if (!start_time) return res.status(400).json({ error: 'start_time is required' });

    // Validate doctor and service belong to business
    if (doctor_id) {
      const doc = await prisma.doctor.findFirst({ where: { id: doctor_id, business_id: req.businessId } });
      if (!doc) return res.status(400).json({ error: 'Invalid doctor_id' });
    }
    if (service_id) {
      const svc = await prisma.service.findFirst({ where: { id: service_id, business_id: req.businessId } });
      if (!svc) return res.status(400).json({ error: 'Invalid service_id' });
    }

    const slot = await prisma.appointmentSlot.create({
      data: {
        business_id: req.businessId,
        doctor_id: doctor_id || null,
        service_id: service_id || null,
        start_time: new Date(start_time),
        end_time: end_time ? new Date(end_time) : null,
      },
    });
    res.status(201).json({ slot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/slots/:id', async (req, res) => {
  try {
    const existing = await prisma.appointmentSlot.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.json({ success: true });
    if (existing.is_booked) {
      return res.status(409).json({ error: 'Cannot delete a booked slot' });
    }
    await prisma.appointmentSlot.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Appointments ─────────────────────────────────────────────────────────────

router.get('/appointments', async (req, res) => {
  try {
    const { status, date, page = 1, limit = 50 } = req.query;
    const where = { business_id: req.businessId };
    if (status) where.status = status;
    if (date) {
      const d = new Date(date);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.scheduled_at = { gte: d, lt: next };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        orderBy: { scheduled_at: 'asc' },
        skip,
        take: parseInt(limit),
        include: {
          doctor: { select: { id: true, name_ar: true } },
          service: { select: { id: true, name_ar: true, duration_minutes: true } },
          slot: { select: { id: true, start_time: true, end_time: true } },
        },
      }),
      prisma.appointment.count({ where }),
    ]);

    res.json({ appointments, total, page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/appointments', async (req, res) => {
  try {
    const { customer_name, customer_phone, customer_wa_id, doctor_id, service_id, slot_id, scheduled_at, notes } = req.body;

    if (slot_id) {
      const slot = await prisma.appointmentSlot.findFirst({
        where: { id: slot_id, business_id: req.businessId },
      });
      if (!slot) return res.status(400).json({ error: 'Invalid slot_id' });
      if (slot.is_booked) return res.status(409).json({ error: 'Slot is already booked' });
    }

    const appointment = await prisma.$transaction(async (tx) => {
      const appt = await tx.appointment.create({
        data: {
          business_id: req.businessId,
          customer_name: customer_name || null,
          customer_phone: customer_phone || null,
          customer_wa_id: customer_wa_id || null,
          doctor_id: doctor_id || null,
          service_id: service_id || null,
          slot_id: slot_id || null,
          scheduled_at: scheduled_at ? new Date(scheduled_at) : null,
          notes: notes || null,
          status: 'confirmed',
        },
        include: {
          doctor: { select: { id: true, name_ar: true } },
          service: { select: { id: true, name_ar: true } },
        },
      });

      if (slot_id) {
        await tx.appointmentSlot.update({
          where: { id: slot_id },
          data: { is_booked: true },
        });
      }

      return appt;
    });

    res.status(201).json({ appointment });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const VALID_APPOINTMENT_STATUSES = ['draft', 'confirmed', 'completed', 'cancelled', 'no_show'];

router.patch('/appointments/:id', async (req, res) => {
  try {
    const existing = await prisma.appointment.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.status(404).json({ error: 'Appointment not found' });

    const { status, notes, scheduled_at } = req.body;
    const data = {};

    if (status !== undefined) {
      if (!VALID_APPOINTMENT_STATUSES.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Valid: ${VALID_APPOINTMENT_STATUSES.join(', ')}` });
      }
      data.status = status;
    }
    if (notes !== undefined) data.notes = notes;
    if (scheduled_at !== undefined) data.scheduled_at = new Date(scheduled_at);

    // Free the slot if appointment is cancelled
    if (status === 'cancelled' && existing.slot_id) {
      await prisma.$transaction([
        prisma.appointment.update({ where: { id: req.params.id }, data }),
        prisma.appointmentSlot.update({
          where: { id: existing.slot_id },
          data: { is_booked: false },
        }),
      ]);
      const updated = await prisma.appointment.findUnique({ where: { id: req.params.id } });
      return res.json({ appointment: updated });
    }

    const appointment = await prisma.appointment.update({
      where: { id: req.params.id },
      data,
      include: {
        doctor: { select: { id: true, name_ar: true } },
        service: { select: { id: true, name_ar: true } },
        slot: { select: { id: true, start_time: true, end_time: true } },
      },
    });
    res.json({ appointment });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
