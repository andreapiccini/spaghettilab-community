#ifndef SPAGHETTI_TEST_SETTINGS_H
#define SPAGHETTI_TEST_SETTINGS_H

#include <stddef.h>
#include <sys/types.h>

typedef ssize_t (*settings_read_cb)(void *cb_arg, void *data, size_t len);

struct settings_handler_static {
	const char *name;
	int cprio;
	int (*h_get)(const char *key, char *val, int val_len_max);
	int (*h_set)(const char *key, size_t len, settings_read_cb read_cb,
		     void *cb_arg);
	int (*h_commit)(void);
	int (*h_export)(int (*export_func)(const char *name, const void *val,
					  size_t val_len));
};

#define SETTINGS_STATIC_HANDLER_DEFINE(_hname, _tree, _get, _set, _commit,    \
				       _export)                               \
	const struct settings_handler_static settings_handler_##_hname = {         \
		.name = _tree,                                                      \
		.h_get = _get,                                                      \
		.h_set = _set,                                                      \
		.h_commit = _commit,                                                \
		.h_export = _export,                                                \
	}

int spaghetti_test_settings_subsys_init(void);
int spaghetti_test_settings_load_subtree(const char *subtree);
int spaghetti_test_settings_save_one(const char *name, const void *value,
				     size_t val_len);
int spaghetti_test_settings_delete(const char *name);

#define settings_subsys_init spaghetti_test_settings_subsys_init
#define settings_load_subtree spaghetti_test_settings_load_subtree
#define settings_save_one spaghetti_test_settings_save_one
#define settings_delete spaghetti_test_settings_delete

#endif /* SPAGHETTI_TEST_SETTINGS_H */
