#ifndef SPAGHETTI_DS18B20_WIRE_H_
#define SPAGHETTI_DS18B20_WIRE_H_

/* Keep direction, input sensing and open-drain configured throughout a transaction.
 * gpio_pin_configure() reprograms the ESP32 pad and must not run inside bit slots. */
static int ds_reset(const struct gpio_dt_spec *pin)
{
 int err = gpio_pin_configure(pin->port, pin->pin,
     GPIO_INPUT | GPIO_OUTPUT_HIGH | GPIO_OPEN_DRAIN | GPIO_PULL_UP);
 if (err) return err;
 k_busy_wait(5);
 int idle = gpio_pin_get_raw(pin->port, pin->pin);
 if (idle < 0) return idle;
 if (!idle) return -EBUSY;
 unsigned key = irq_lock();
 err = gpio_pin_set_raw(pin->port, pin->pin, 0);
 if (!err) {
   k_busy_wait(480);
   err = gpio_pin_set_raw(pin->port, pin->pin, 1);
   k_busy_wait(70);
   if (!err) {
     int value = gpio_pin_get_raw(pin->port, pin->pin);
     err = value < 0 ? value : value ? -ENODEV : 0;
   }
   k_busy_wait(410);
 }
 irq_unlock(key);
 if (!err) {
   int level = gpio_pin_get_raw(pin->port, pin->pin);
   err = level < 0 ? level : level ? 0 : -EIO;
 }
 return err;
}
static int ds_write(const struct gpio_dt_spec *pin, uint8_t value, bool strong)
{
 for (unsigned bit = 0; bit < 8; bit++) {
   unsigned key = irq_lock();
   bool one = (value >> bit) & 1;
   int err = gpio_pin_set_raw(pin->port, pin->pin, 0);
   if (!err) {
     k_busy_wait(one ? 6 : 60);
     err = gpio_pin_set_raw(pin->port, pin->pin, 1);
     /* Only the last Convert T bit may switch to push-pull for parasite power. */
     if (!err && strong && bit == 7)
       err = gpio_pin_configure(pin->port, pin->pin, GPIO_OUTPUT_HIGH);
     k_busy_wait(one ? 64 : 10);
   }
   irq_unlock(key);
   if (err) return err;
 }
 return 0;
}
static int ds_read_byte(const struct gpio_dt_spec *pin)
{
 uint8_t value = 0;
 for (unsigned bit = 0; bit < 8; bit++) {
   unsigned key = irq_lock();
   int err = gpio_pin_set_raw(pin->port, pin->pin, 0);
   if (!err) {
     k_busy_wait(2);
     err = gpio_pin_set_raw(pin->port, pin->pin, 1);
   }
   /* Sample 12 us from the falling edge, within the 15 us data-valid window. */
   k_busy_wait(10);
   int level = err ? err : gpio_pin_get_raw(pin->port, pin->pin);
   k_busy_wait(58);
   irq_unlock(key);
   if (level < 0) return level;
   if (level) value |= BIT(bit);
 }
 return value;
}

#endif
