#include <spaghetti/protocol.h>
#include <spaghetti/field_update.h>
#include <errno.h>
#include <string.h>
#include <zcbor_encode.h>
#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor nfc_schema = {
 .schema_id = "spaghetti.protocol.nfc.page", .version = 1U,
};
static int execute_nfc_page(const struct spaghetti_request_context *context,
 const struct spaghetti_protocol_payload *request, struct spaghetti_protocol_payload *response)
{
 ARG_UNUSED(context);
 uint32_t node, antenna, page, write;
 const uint8_t *uid = NULL, *input = NULL;
 size_t uid_size = 0U, input_size = 0U;
 uint8_t data[4] = {0};
 int err = spaghetti_ops_decode_u32(request, 0U, &node);
 if (!err) err = spaghetti_ops_decode_u32(request, 1U, &antenna);
 if (!err) err = spaghetti_ops_decode_bstr(request, 2U, &uid, &uid_size);
 if (!err) err = spaghetti_ops_decode_u32(request, 3U, &page);
 if (!err) err = spaghetti_ops_decode_u32(request, 4U, &write);
 if (err) return err;
 if (uid_size != 7U || antenna < 1U || antenna > 2U || page > 255U || write > 1U || node > 0xffffffU) return -EINVAL;
 if (write) {
  err = spaghetti_ops_decode_bstr(request, 5U, &input, &input_size);
  if (err) return err;
  if (input_size != 4U) return -EINVAL;
  memcpy(data, input, 4U);
 }
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE)
 err = spaghetti_field_update_nfc_page(node, antenna, uid, (uint8_t)page, data, write != 0U);
#else
 err = -ENOTSUP;
#endif
 if (err) return err;
 ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes, sizeof(response->bytes), 1U);
 if (!zcbor_map_start_encode(state, 2U) || !zcbor_uint32_put(state, 0U) || !zcbor_uint32_put(state, page) ||
     !zcbor_uint32_put(state, 1U) || !zcbor_bstr_encode_ptr(state, data, 4U) || !zcbor_map_end_encode(state, 2U)) return -EMSGSIZE;
 response->size = state->payload - response->bytes;
 return 0;
}
SPAGHETTI_OPERATION_HANDLER_DEFINE(op_nfc_page) = {
 .operation = SPAGHETTI_PROTOCOL_NFC_PAGE,
 .required_permissions = SPAGHETTI_PERMISSION_CONFIGURE,
 .execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
 .request_schema = &nfc_schema, .response_schema = &nfc_schema,
 .execute = execute_nfc_page,
};
